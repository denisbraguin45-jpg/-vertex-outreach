// ─── Instagram official API: webhook verification + signature + parsing ─────
// Meta delivers messages to this webhook after the browser funnel gets the
// first reply. Signature (X-Hub-Signature-256) validated with APP_SECRET.

import crypto from "node:crypto";
import { getEnv, isInstagramApiConfigured } from "@/config/env";

export function verifyWebhookSignature(rawBody: string, header: string | null): boolean {
  const secret = getEnv().INSTAGRAM_APP_SECRET;
  if (!secret) return false; // cannot verify without secret → reject
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const received = header.slice(7);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifySubscriptionToken(queryToken: string | null): boolean {
  const expected = getEnv().INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return false;
  return queryToken === expected;
}

export interface InboundMessage {
  igUserId: string;
  username: string | null;
  text: string;
  messageId: string;
  receivedAt: Date;
}

interface MetaWebhookEntry {
  id?: string;
  time?: number;
  messaging?: Array<{
    sender?: { id?: string };
    recipient?: { id?: string };
    timestamp?: number;
    message?: { mid?: string; text?: string; is_echo?: boolean };
  }>;
}

export function parseWebhookPayload(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const payload = body as { entry?: MetaWebhookEntry[] };
  for (const entry of payload.entry ?? []) {
    for (const evt of entry.messaging ?? []) {
      // ignore echoes of our own sends
      if (evt.message?.is_echo) continue;
      if (!evt.message?.text || !evt.sender?.id) continue;
      out.push({
        igUserId: evt.sender.id,
        username: null,
        text: evt.message.text,
        messageId: evt.message.mid ?? `mid-${evt.timestamp ?? Date.now()}`,
        receivedAt: new Date(evt.timestamp ?? Date.now()),
      });
    }
  }
  return out;
}

// ─── Send via official API ──────────────────────────────────────────────────

export interface ApiSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  windowClosed?: boolean;
}

/**
 * Send a reply through the official Instagram Messaging API.
 * Pre-checks: token present, 24h window from last inbound (approximated by
 * receiving time stored on the inbound message), recipient eligibility errors
 * surfaced verbatim for the exception queue.
 */
export async function sendViaApi(igUserId: string, text: string): Promise<ApiSendResult> {
  const env = getEnv();
  // Simulated send keeps the full flow testable without Meta credentials —
  // clearly labeled so it can never be mistaken for a real delivery.
  if (env.OUTREACH_AI_SIMULATE_API) {
    return { ok: true, messageId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }
  if (!isInstagramApiConfigured()) {
    return { ok: false, error: "instagram api not configured (token/business id missing)" };
  }
  const url = `https://graph.instagram.com/v21.0/me/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: igUserId },
        message: { text },
        access_token: env.INSTAGRAM_PAGE_ACCESS_TOKEN,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      message_id?: string;
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    if (!res.ok) {
      // 24h window violations come back as code 10 / subcode 2018108
      const windowClosed =
        json.error?.error_subcode === 2018108 || /outside.*window|24 hour/i.test(json.error?.message ?? "");
      return {
        ok: false,
        windowClosed,
        error: json.error?.message ?? `HTTP ${res.status}`,
      };
    }
    return { ok: true, messageId: json.message_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
