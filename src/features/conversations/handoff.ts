// ─── Channel handoff: browser → webhook → official API ─────────────────────
// When the lead's first reply arrives via webhook, ownership of the thread
// passes to the API. The browser worker never touches the thread again.

import type { InboundMessage } from "@/integrations/instagram/webhook";
import { sendViaApi } from "@/integrations/instagram/webhook";
import { upsertLead, transitionLead } from "@/db/leads";
import { appendMessage, canSendVia } from "@/db/messages";
import { interpretInbound, composeReply, applyAction } from "./engine";
import { getDb, recordEvent } from "@/db/index";
import type { LeadRecord } from "@/db";

export interface HandoffOutcome {
  processed: boolean;
  leadId: string | null;
  action: string;
  reason: string;
}

/**
 * Process one inbound message from the webhook.
 * Idempotent by meta_message_id (unique index in messages).
 */
export async function processInboundMessage(msg: InboundMessage): Promise<HandoffOutcome> {
  // Match to a lead by instagram_user_id across both funnels; if unknown,
  // create a clients-funnel lead (inbound without first contact = organic).
  let lead =
    findLeadByIgId(msg.igUserId) ??
    upsertLead({
      funnel: "clients",
      instagram_handle: msg.username ?? `ig-${msg.igUserId}`,
      instagram_user_id: msg.igUserId,
      full_name: msg.username ?? `IG ${msg.igUserId.slice(-6)}`,
      score: 50,
      priority: 2,
    }).lead;

  // Idempotent record of the inbound message.
  const appended = appendMessage({
    lead_id: lead.id,
    direction: "inbound",
    channel: "api",
    body: msg.text,
    meta_message_id: msg.messageId,
  });
  if (appended.duplicated) {
    return { processed: false, leadId: lead.id, action: "skip", reason: "duplicate webhook delivery" };
  }

  // Handoff: channel ownership moves to the API the moment an inbound arrives.
  lead = transitionLead(
    lead.id,
    lead.pipeline === "contacted" ? "replied" : null,
    lead.channel === "waiting_inbound_reply" ? "api_eligible" : null,
    "inbound received via webhook",
  ) ?? lead;

  if (lead.channel === "api_eligible") {
    transitionLead(lead.id, null, "api_active", "AI takes over the conversation");
  }

  // Ownership guard: API must be the owner before replying.
  if (!canSendVia(lead.id, "api")) {
    recordEvent("warn", "channel_ownership_conflict", { owner: "browser" }, lead.id);
    transitionLead(lead.id, null, "human_review_required", "ownership conflict on inbound");
    return { processed: false, leadId: lead.id, action: "escalate", reason: "channel ownership conflict" };
  }

  // Interpret + decide + reply — autonomously.
  const interpretation = await interpretInbound(lead, msg.text);
  let reply: string | null = null;
  try {
    reply = await composeReply(lead, interpretation);
  } catch (err) {
    // OpenAI not configured/budget exceeded → human review, never crash the loop.
    recordEvent("warn", "reply_paused_no_ai", {
      error: err instanceof Error ? err.message : String(err),
    }, lead.id);
    transitionLead(lead.id, null, "human_review_required", "resposta exigiria IA indisponível");
    return { processed: true, leadId: lead.id, action: "exception", reason: "AI unavailable — lead sent to human review" };
  }

  if (reply) {
    const send = await sendViaApi(msg.igUserId, reply);
    if (send.ok) {
      appendMessage({
        lead_id: lead.id,
        direction: "outbound",
        channel: "api",
        body: reply,
        ai_action: interpretation.action,
        intent: interpretation.intent,
        meta_message_id: send.messageId ?? null,
      });
    } else if (send.windowClosed) {
      transitionLead(lead.id, null, "api_window_closed", "24h window expired");
      recordEvent("warn", "api_window_closed", { igUserId: msg.igUserId }, lead.id);
      return { processed: true, leadId: lead.id, action: "window_closed", reason: send.error ?? "24h window" };
    } else {
      // API misconfigured/down → exception queue, NEVER fall back to browser.
      transitionLead(lead.id, null, "human_review_required", `api send failed: ${send.error?.slice(0, 100)}`);
      recordEvent("error", "api_send_failed", { error: send.error }, lead.id);
      return { processed: true, leadId: lead.id, action: "exception", reason: send.error ?? "api failed" };
    }
  }

  await applyAction(lead, interpretation, null);
  return {
    processed: true,
    leadId: lead.id,
    action: interpretation.action,
    reason: interpretation.reason,
  };
}

function findLeadByIgId(igUserId: string): LeadRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM leads WHERE instagram_user_id = ? LIMIT 1")
    .get(igUserId) as LeadRecord | undefined;
  return row ?? null;
}

/** 48h window sweep: leads waiting too long get flagged for review. */
export function sweepWaitingReplies(): number {
  const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString();
  const stale = getDb()
    .prepare(
      `SELECT id FROM leads WHERE channel = 'waiting_inbound_reply' AND last_contacted_at < ?`,
    )
    .all(cutoff) as Array<{ id: string }>;
  for (const row of stale) {
    transitionLead(row.id, null, "api_window_closed", "48h sem resposta após primeira DM");
  }
  recordEvent("info", "waiting_sweep", { flagged: stale.length });
  return stale.length;
}
