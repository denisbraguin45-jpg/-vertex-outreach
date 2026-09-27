// ─── Messages repository + channel ownership lock ───────────────────────────

import { getDb, nowISO, newId } from "./index";
import { asRow, asRows } from "./rows";
import type { AiAction, Intent, MessageRecord } from "./index";

export interface AppendMessageInput {
  lead_id: string;
  direction: "outbound" | "inbound";
  channel: "browser" | "api" | "system";
  body: string;
  variant?: string | null;
  intent?: Intent | null;
  ai_action?: AiAction | null;
  meta_message_id?: string | null;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
}

export interface AppendResult {
  message: MessageRecord;
  duplicated: boolean;
}

/**
 * Append a message. When meta_message_id exists, the unique index makes the
 * insert idempotent: the same webhook delivery never creates a duplicate.
 */
export function appendMessage(input: AppendMessageInput): AppendResult {
  const d = getDb();
  const id = newId();
  try {
    d.prepare(`
      INSERT INTO messages (id, lead_id, direction, channel, body, variant, intent, ai_action,
        meta_message_id, tokens_in, tokens_out, cost_usd, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.lead_id, input.direction, input.channel, input.body,
      input.variant ?? null, input.intent ?? null, input.ai_action ?? null,
      input.meta_message_id ?? null, input.tokens_in ?? 0, input.tokens_out ?? 0,
      input.cost_usd ?? 0, nowISO(),
    );
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message) && input.meta_message_id) {
      const existing = asRow<MessageRecord>(
        d.prepare("SELECT * FROM messages WHERE meta_message_id = ?").get(input.meta_message_id),
      );
      if (existing) return { message: existing, duplicated: true };
    }
    throw err;
  }
  return { message: getMessage(id)!, duplicated: false };
}

export function getMessage(id: string): MessageRecord | null {
  return asRow<MessageRecord>(getDb().prepare("SELECT * FROM messages WHERE id = ?").get(id));
}

export function leadHistory(leadId: string, limit = 100): MessageRecord[] {
  return asRows<MessageRecord>(
    getDb().prepare("SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at ASC LIMIT ?").all(leadId, limit),
  );
}

export function lastOutbound(leadId: string): MessageRecord | null {
  return asRow<MessageRecord>(
    getDb()
      .prepare(
        "SELECT * FROM messages WHERE lead_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1",
      )
      .get(leadId),
  );
}

/**
 * CHANNEL OWNERSHIP LOCK.
 * A thread is owned by exactly one channel at a time:
 *   - last outbound/inbound via browser and no inbound after → browser owns
 *   - any inbound received (webhook) → api owns from that moment
 * Callers must check before sending; this prevents the browser worker and the
 * official API from replying to the same thread simultaneously.
 */
export type ChannelOwner = "browser" | "api" | "none";

export function channelOwner(leadId: string): ChannelOwner {
  const row = asRow<{ direction: string; channel: string }>(
    getDb()
      .prepare(
        `SELECT direction, channel FROM messages
         WHERE lead_id = ? AND channel IN ('browser','api')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(leadId),
  );
  if (!row) return "none";
  if (row.channel === "api") return "api";
  // browser sent but lead never replied → still browser-owned (waiting inbound)
  return row.direction === "inbound" ? "api" : "browser";
}

/** True when it is safe for the given channel to send now. */
export function canSendVia(leadId: string, via: "browser" | "api"): boolean {
  const owner = channelOwner(leadId);
  if (owner === "none") return via === "browser"; // first contact is browser-only
  return owner === via;
}

// ─── AI cost tracking ────────────────────────────────────────────────────────

export function recordAiCall(input: {
  lead_id: string | null;
  purpose: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}): void {
  getDb()
    .prepare(
      "INSERT INTO ai_calls (id, lead_id, purpose, model, tokens_in, tokens_out, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(newId(), input.lead_id, input.purpose, input.model, input.tokens_in, input.tokens_out, input.cost_usd, nowISO());
}

export function monthlyAiSpend(): number {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM ai_calls WHERE created_at >= ?")
    .get(monthStart.toISOString()) as { total: number };
  return row.total;
}

export interface AiCostStats {
  monthTotal: number;
  byModel: Array<{ model: string; calls: number; tokens: number; cost: number }>;
}

export function aiCostStats(): AiCostStats {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const byModel = getDb()
    .prepare(`
      SELECT model, COUNT(*) as calls,
             SUM(tokens_in + tokens_out) as tokens,
             ROUND(SUM(cost_usd), 4) as cost
      FROM ai_calls WHERE created_at >= ?
      GROUP BY model ORDER BY cost DESC
    `)
    .all(monthStart.toISOString()) as unknown as AiCostStats["byModel"];
  return { monthTotal: monthlyAiSpend(), byModel };
}
