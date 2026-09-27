// ─── Leads repository: dedupe, atomic pipeline/channel transitions ──────────

import { getDb, nowISO, newId, recordEvent } from "./index";
import { asRow, asRows } from "./rows";
import type { ChannelState, FunnelKind, LeadRecord, Pipeline } from "./index";

/** Valid pipeline transitions. Anything else is rejected (auditable state machine). */
const PIPELINE_FLOW: Record<string, Pipeline[]> = {
  discovered: ["qualified", "closed"],
  qualified: ["contacted", "closed"],
  contacted: ["replied", "closed"],
  replied: ["interested", "contacted", "closed"],
  interested: ["whatsapp_handoff", "joined_affiliate_group", "replied", "closed"],
  whatsapp_handoff: ["registered", "interested", "closed"],
  joined_affiliate_group: ["active_affiliate", "closed"],
  registered: ["active_customer", "closed"],
  active_customer: ["closed"],
  active_affiliate: ["generated_customer", "closed"],
  generated_customer: ["closed"],
  closed: [],
};

const CHANNEL_FLOW: Record<string, ChannelState[]> = {
  browser_contact_pending: ["browser_contact_sent", "do_not_contact", "blocked", "human_review_required"],
  browser_contact_sent: ["waiting_inbound_reply", "human_review_required", "do_not_contact", "blocked"],
  waiting_inbound_reply: ["api_eligible", "do_not_contact", "blocked", "human_review_required"],
  api_eligible: ["api_active", "api_window_closed", "do_not_contact", "human_review_required"],
  api_active: ["api_window_closed", "do_not_contact", "human_review_required", "completed"],
  api_window_closed: ["human_review_required", "completed", "do_not_contact"],
  human_review_required: ["browser_contact_pending", "api_eligible", "do_not_contact", "completed"],
  do_not_contact: [],
  blocked: ["do_not_contact"],
  completed: [],
};

export interface CreateLeadInput {
  funnel: FunnelKind;
  instagram_handle: string;
  full_name: string;
  instagram_user_id?: string | null;
  profile_type?: LeadRecord["profile_type"];
  niche?: string | null;
  segment?: string | null;
  bio?: string | null;
  followers?: number;
  location?: string | null;
  score?: number;
  priority?: number;
  source_keyword?: string | null;
  tags?: string[];
}

export interface UpsertResult {
  lead: LeadRecord;
  created: boolean;
}

/**
 * Idempotent lead upsert. Unique index on (funnel, instagram_handle) makes
 * duplicates impossible; discovery jobs call this freely.
 * do_not_contact never re-enters — checked before insert and on update.
 */
export function upsertLead(input: CreateLeadInput): UpsertResult {
  const d = getDb();
  const handle = input.instagram_handle.trim().toLowerCase().replace(/^@/, "");

  const existing = asRow<LeadRecord>(
    d.prepare("SELECT * FROM leads WHERE funnel = ? AND instagram_handle = ?").get(input.funnel, handle),
  );

  if (existing) {
    if (existing.channel === "do_not_contact") {
      recordEvent("info", "dnc_skip", { handle }, existing.id);
      return { lead: existing, created: false };
    }
    // refresh discovery data without touching pipeline/channel
    d.prepare(`
      UPDATE leads SET
        full_name = COALESCE(?, full_name),
        instagram_user_id = COALESCE(?, instagram_user_id),
        bio = COALESCE(?, bio),
        followers = CASE WHEN ? > 0 THEN ? ELSE followers END,
        niche = COALESCE(?, niche),
        segment = COALESCE(?, segment),
        location = COALESCE(?, location),
        score = CASE WHEN ? > 0 THEN ? ELSE score END,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.full_name, input.instagram_user_id ?? null, input.bio ?? null,
      input.followers ?? 0, input.followers ?? 0,
      input.niche ?? null, input.segment ?? null, input.location ?? null,
      input.score ?? 0, input.score ?? 0,
      nowISO(), existing.id,
    );
    return { lead: getLead(existing.id)!, created: false };
  }

  const id = newId();
  d.prepare(`
    INSERT INTO leads (id, funnel, instagram_handle, instagram_user_id, full_name, profile_type,
      niche, segment, bio, followers, location, score, priority, pipeline, channel,
      source_keyword, tags_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', 'browser_contact_pending', ?, ?, ?, ?)
  `).run(
    id, input.funnel, handle, input.instagram_user_id ?? null, input.full_name,
    input.profile_type ?? "unknown", input.niche ?? null, input.segment ?? null,
    input.bio ?? null, input.followers ?? 0, input.location ?? null,
    input.score ?? 0, input.priority ?? 2, input.source_keyword ?? null,
    JSON.stringify(input.tags ?? []), nowISO(), nowISO(),
  );
  return { lead: getLead(id)!, created: true };
}

export function getLead(id: string): LeadRecord | null {
  return asRow<LeadRecord>(getDb().prepare("SELECT * FROM leads WHERE id = ?").get(id));
}

export function getLeadByHandle(funnel: FunnelKind, handle: string): LeadRecord | null {
  return asRow<LeadRecord>(
    getDb()
      .prepare("SELECT * FROM leads WHERE funnel = ? AND instagram_handle = ?")
      .get(funnel, handle.trim().toLowerCase().replace(/^@/, "")),
  );
}

export interface LeadFilters {
  funnel?: FunnelKind;
  pipeline?: Pipeline;
  channel?: ChannelState;
  minScore?: number;
  search?: string;
  dueOnly?: boolean;
  limit?: number;
}

/** node:sqlite accepts only concrete SQL values (no undefined/null spreads). */
type SqlParam = string | number | null;

export function listLeads(filters: LeadFilters = {}): LeadRecord[] {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (filters.funnel) { where.push("funnel = ?"); params.push(filters.funnel); }
  if (filters.pipeline) { where.push("pipeline = ?"); params.push(filters.pipeline); }
  if (filters.channel) { where.push("channel = ?"); params.push(filters.channel); }
  if (filters.minScore) { where.push("score >= ?"); params.push(filters.minScore); }
  if (filters.search) {
    where.push("(instagram_handle LIKE ? OR full_name LIKE ? OR niche LIKE ?)");
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }
  if (filters.dueOnly) {
    where.push("next_action_at IS NOT NULL AND next_action_at <= ?");
    params.push(nowISO());
  }
  const sql = `
    SELECT * FROM leads
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY priority ASC, score DESC, updated_at DESC
    LIMIT ?
  `;
  params.push(filters.limit ?? 200);
  return asRows<LeadRecord>(getDb().prepare(sql).all(...params));
}

/**
 * Atomic transition with state-machine validation + audit event.
 * Returns null when transition is invalid (caller decides what to log).
 */
export function transitionLead(
  id: string,
  toPipeline: Pipeline | null,
  toChannel: ChannelState | null,
  reason: string,
): LeadRecord | null {
  const d = getDb();
  const lead = getLead(id);
  if (!lead) return null;

  if (lead.channel === "do_not_contact" && toChannel !== "do_not_contact") {
    recordEvent("warn", "dnc_transition_blocked", { reason, requested: { toPipeline, toChannel } }, id);
    return null;
  }

  if (toPipeline && toPipeline !== lead.pipeline) {
    const allowed = PIPELINE_FLOW[lead.pipeline] ?? [];
    if (!allowed.includes(toPipeline)) {
      recordEvent("warn", "invalid_pipeline_transition", { from: lead.pipeline, to: toPipeline, reason }, id);
      return null;
    }
  }
  if (toChannel && toChannel !== lead.channel) {
    const allowed = CHANNEL_FLOW[lead.channel] ?? [];
    if (!allowed.includes(toChannel)) {
      recordEvent("warn", "invalid_channel_transition", { from: lead.channel, to: toChannel, reason }, id);
      return null;
    }
  }

  const res = d.prepare(`
    UPDATE leads SET
      pipeline = COALESCE(?, pipeline),
      channel = COALESCE(?, channel),
      last_contacted_at = CASE WHEN ? = 'browser_contact_sent' OR ? = 'api_active' THEN ? ELSE last_contacted_at END,
      updated_at = ?
    WHERE id = ?
  `).run(
    toPipeline ?? null, toChannel ?? null,
    toChannel ?? "", toChannel ?? "", nowISO(),
    nowISO(), id,
  );
  void res;
  recordEvent("info", "lead_transition", { from: { p: lead.pipeline, c: lead.channel }, to: { p: toPipeline, c: toChannel }, reason }, id);
  return getLead(id);
}

/** Permanent opt-out. No follow-up, no re-entry, any funnel, any channel. */
export function markDoNotContact(id: string, motive: string): void {
  const d = getDb();
  d.prepare("UPDATE leads SET channel = 'do_not_contact', updated_at = ? WHERE id = ?").run(nowISO(), id);
  recordEvent("warn", "opt_out", { motive }, id);
}

export function setNextAction(id: string, whenISO: string | null): void {
  getDb().prepare("UPDATE leads SET next_action_at = ?, updated_at = ? WHERE id = ?").run(whenISO, nowISO(), id);
}

export function setProfileQualification(id: string, patch: {
  profile_type?: LeadRecord["profile_type"];
  score?: number;
  priority?: number;
  niche?: string | null;
  segment?: string | null;
}): void {
  const d = getDb();
  d.prepare(`
    UPDATE leads SET
      profile_type = COALESCE(?, profile_type),
      score = COALESCE(?, score),
      priority = COALESCE(?, priority),
      niche = COALESCE(?, niche),
      segment = COALESCE(?, segment),
      updated_at = ?
    WHERE id = ?
  `).run(patch.profile_type ?? null, patch.score ?? null, patch.priority ?? null, patch.niche ?? null, patch.segment ?? null, nowISO(), id);
}

export function appendNote(id: string, note: string): void {
  const lead = getLead(id);
  if (!lead) return;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const updated = `${lead.notes ? lead.notes + "\n" : ""}[${stamp}] ${note}`;
  getDb().prepare("UPDATE leads SET notes = ?, updated_at = ? WHERE id = ?").run(updated, nowISO(), id);
}

/** Funnel + channel counters for the dashboard. */
export function funnelCounters(): Array<{ funnel: string; pipeline: string; channel: string; count: number }> {
  return getDb()
    .prepare(`SELECT funnel, pipeline, channel, COUNT(*) as count FROM leads GROUP BY funnel, pipeline, channel`)
    .all() as unknown as Array<{ funnel: string; pipeline: string; channel: string; count: number }>;
}
