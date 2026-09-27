// ─── Database: SQLite via node:sqlite (Node ≥ 22.5, tested on 24 LTS) ───────
// Source of truth for the MVP. WAL + busy_timeout + UTC timestamps.
// States are internal English values; the UI translates to PT-BR.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "@/config/env";

// ─── Domain states (English internal, translated in UI) ─────────────────────

export type FunnelKind = "clients" | "affiliates";

export type ClientPipeline =
  | "discovered" | "qualified" | "contacted" | "replied" | "interested"
  | "whatsapp_handoff" | "registered" | "active_customer" | "closed";

export type AffiliatePipeline =
  | "discovered" | "qualified" | "contacted" | "replied" | "interested"
  | "joined_affiliate_group" | "active_affiliate" | "generated_customer" | "closed";

export type Pipeline = ClientPipeline | AffiliatePipeline;

export type ChannelState =
  | "browser_contact_pending" | "browser_contact_sent" | "waiting_inbound_reply"
  | "api_eligible" | "api_active" | "api_window_closed"
  | "human_review_required" | "do_not_contact" | "blocked" | "completed";

export type Intent =
  | "interested" | "asked_info" | "asked_pricing" | "wants_whatsapp"
  | "not_the_owner" | "will_forward" | "objection" | "not_interested"
  | "opt_out" | "ambiguous" | "needs_human";

export type AiAction =
  | "reply" | "ask" | "present" | "handle_objection" | "handoff_whatsapp"
  | "handoff_affiliate_group" | "wait" | "schedule_followup" | "close" | "escalate_human";

export interface LeadRecord {
  id: string;
  funnel: FunnelKind;
  instagram_handle: string;
  instagram_user_id: string | null;
  full_name: string;
  profile_type: "store" | "employee" | "owner" | "decision_maker" | "creator" | "unknown";
  niche: string | null;
  segment: string | null;
  bio: string | null;
  followers: number;
  location: string | null;
  score: number;
  priority: number; // 1 high … 3 low
  pipeline: Pipeline;
  channel: ChannelState;
  source_keyword: string | null;
  tags_json: string;
  notes: string | null;
  next_action_at: string | null;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRecord {
  id: string;
  lead_id: string;
  direction: "outbound" | "inbound";
  channel: "browser" | "api" | "system";
  body: string;
  variant: string | null;
  intent: Intent | null;
  ai_action: AiAction | null;
  meta_message_id: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  created_at: string;
}

export interface JobRecord {
  id: string;
  kind: string;
  payload_json: string;
  status: "queued" | "running" | "done" | "failed" | "paused" | "dead";
  attempts: number;
  max_attempts: number;
  run_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface ExperimentRecord {
  id: string;
  name: string;
  hypothesis: string;
  variable: string; // e.g. "opening_variant", "send_hour"
  status: "draft" | "running" | "concluded" | "archived";
  variants_json: string; // [{key, weight, count, conversions}]
  min_sample_per_variant: number;
  created_at: string;
  concluded_at: string | null;
}

export interface SystemEventRecord {
  id: string;
  level: "info" | "warn" | "error";
  kind: string; // e.g. "browser_unavailable", "budget_exceeded", "opt_out"
  lead_id: string | null;
  detail_json: string;
  created_at: string;
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const dbPath = getEnv().DATABASE_URL;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      funnel TEXT NOT NULL CHECK (funnel IN ('clients','affiliates')),
      instagram_handle TEXT NOT NULL,
      instagram_user_id TEXT,
      full_name TEXT NOT NULL,
      profile_type TEXT NOT NULL DEFAULT 'unknown',
      niche TEXT,
      segment TEXT,
      bio TEXT,
      followers INTEGER NOT NULL DEFAULT 0,
      location TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 2,
      pipeline TEXT NOT NULL DEFAULT 'discovered',
      channel TEXT NOT NULL DEFAULT 'browser_contact_pending',
      source_keyword TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      next_action_at TEXT,
      last_contacted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- one lead per instagram handle per funnel; prevents duplicates
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_unique
      ON leads(funnel, instagram_handle);

    CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads(funnel, pipeline);
    CREATE INDEX IF NOT EXISTS idx_leads_channel ON leads(channel);
    CREATE INDEX IF NOT EXISTS idx_leads_next_action ON leads(next_action_at);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),
      channel TEXT NOT NULL CHECK (channel IN ('browser','api','system')),
      body TEXT NOT NULL,
      variant TEXT,
      intent TEXT,
      ai_action TEXT,
      meta_message_id TEXT,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- idempotency: same meta message id never processed twice
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_meta_id
      ON messages(meta_message_id) WHERE meta_message_id IS NOT NULL;

    -- channel ownership lock: at most one open thread per lead at a time
    CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id, created_at);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','done','failed','paused','dead')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      run_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, run_at);

    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hypothesis TEXT NOT NULL,
      variable TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','running','concluded','archived')),
      variants_json TEXT NOT NULL DEFAULT '[]',
      min_sample_per_variant INTEGER NOT NULL DEFAULT 50,
      created_at TEXT NOT NULL,
      concluded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL CHECK (level IN ('info','warn','error')),
      kind TEXT NOT NULL,
      lead_id TEXT,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, created_at);

    CREATE TABLE IF NOT EXISTS ai_calls (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      purpose TEXT NOT NULL,
      model TEXT NOT NULL,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function nowISO(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function getSystemState(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM system_state WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSystemState(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO system_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function recordEvent(
  level: SystemEventRecord["level"],
  kind: string,
  detail: Record<string, unknown> = {},
  leadId: string | null = null,
): void {
  getDb()
    .prepare("INSERT INTO events (id, level, kind, lead_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(newId(), level, kind, leadId, JSON.stringify(detail), nowISO());
}
