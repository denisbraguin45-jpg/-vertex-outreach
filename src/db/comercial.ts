// ─── Comercial: deals, meetings, inbox (CRM lite — sem pipeline complexo) ───
// Cada prospect pode ter: status de contato, próxima ação, deal com valor e
// status de venda, reuniões com briefing/resumo e respostas classificadas.

import { getDb, nowISO, newId, recordEvent } from "./index";
import { asRow, asRows } from "./rows";
import { ensureProspectSchema, getProspect, setProspectStatus } from "./prospects";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type DealStage = "proposta" | "negociacao" | "ganho" | "perdido";

export interface DealRecord {
  id: string;
  prospect_id: string;
  title: string;
  value_cents: number;
  stage: DealStage;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MeetingRecord {
  id: string;
  prospect_id: string;
  scheduled_at: string | null;
  brief: string | null; // gerado antes da reunião
  notes: string | null; // anotações do operador durante/depois
  summary: string | null; // resumo pós-reunião (IA assistida)
  objections: string | null;
  next_step: string | null;
  created_at: string;
  updated_at: string;
}

export type InboxStatus = "novo" | "lido" | "tratado";

export interface InboxRecord {
  id: string;
  prospect_id: string;
  channel: string;
  body: string;
  intent: string | null; // ReplyIntent classificado
  summary: string | null;
  suggests_meeting: number; // 0/1
  status: InboxStatus;
  created_at: string;
}

// ─── Migração ────────────────────────────────────────────────────────────────

let migrated = false;

export function ensureComercialSchema(): void {
  if (migrated) return;
  ensureProspectSchema();
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      value_cents INTEGER NOT NULL DEFAULT 0,
      stage TEXT NOT NULL DEFAULT 'proposta'
        CHECK (stage IN ('proposta','negociacao','ganho','perdido')),
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deals_prospect ON deals(prospect_id);
    CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);

    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      scheduled_at TEXT,
      brief TEXT,
      notes TEXT,
      summary TEXT,
      objections TEXT,
      next_step TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meetings_prospect ON meetings(prospect_id);

    CREATE TABLE IF NOT EXISTS inbox (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      body TEXT NOT NULL,
      intent TEXT,
      summary TEXT,
      suggests_meeting INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','lido','tratado')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox(status, created_at);
  `);
  migrated = true;
}

// ─── Deals (proposta / venda) ────────────────────────────────────────────────

export function createDeal(input: {
  prospectId: string;
  title: string;
  valueCents?: number;
  notes?: string | null;
}): DealRecord {
  ensureComercialSchema();
  const id = newId();
  getDb()
    .prepare(
      "INSERT INTO deals (id, prospect_id, title, value_cents, stage, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 'proposta', ?, ?, ?)",
    )
    .run(id, input.prospectId, input.title, Math.max(0, Math.round(input.valueCents ?? 0)), input.notes ?? null, nowISO(), nowISO());
  recordEvent("info", "deal_created", { title: input.title }, input.prospectId);
  return getDeal(id)!;
}

export function getDeal(id: string): DealRecord | null {
  ensureComercialSchema();
  return asRow<DealRecord>(getDb().prepare("SELECT * FROM deals WHERE id = ?").get(id));
}

export function listDeals(opts: { prospectId?: string; stage?: DealStage } = {}): DealRecord[] {
  ensureComercialSchema();
  const where: string[] = [];
  const params: Array<string> = [];
  if (opts.prospectId) { where.push("prospect_id = ?"); params.push(opts.prospectId); }
  if (opts.stage) { where.push("stage = ?"); params.push(opts.stage); }
  const sql = `SELECT * FROM deals ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 500`;
  return asRows<DealRecord>(getDb().prepare(sql).all(...params));
}

export function setDealStage(id: string, stage: DealStage, notes?: string): DealRecord | null {
  ensureComercialSchema();
  const deal = getDeal(id);
  if (!deal) return null;
  getDb().prepare("UPDATE deals SET stage = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?")
    .run(stage, notes ?? null, nowISO(), id);
  if (stage === "ganho") {
    recordEvent("info", "deal_won", { value_cents: deal.value_cents }, deal.prospect_id);
    // venda marcada: prospect vai para interessado/entrega
    const p = getProspect(deal.prospect_id);
    if (p && p.status !== "opt_out") setProspectStatus(deal.prospect_id, "interessado");
  }
  return getDeal(id);
}

// ─── Meetings (briefing antes, resumo depois) ────────────────────────────────

export function createMeeting(input: { prospectId: string; scheduledAt?: string | null }): MeetingRecord {
  ensureComercialSchema();
  const id = newId();
  getDb()
    .prepare("INSERT INTO meetings (id, prospect_id, scheduled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, input.prospectId, input.scheduledAt ?? null, nowISO(), nowISO());
  return getMeeting(id)!;
}

export function getMeeting(id: string): MeetingRecord | null {
  ensureComercialSchema();
  return asRow<MeetingRecord>(getDb().prepare("SELECT * FROM meetings WHERE id = ?").get(id));
}

export function listMeetings(prospectId?: string): MeetingRecord[] {
  ensureComercialSchema();
  const sql = prospectId
    ? "SELECT * FROM meetings WHERE prospect_id = ? ORDER BY created_at DESC LIMIT 200"
    : "SELECT * FROM meetings ORDER BY created_at DESC LIMIT 200";
  return asRows<MeetingRecord>(
    prospectId ? getDb().prepare(sql).all(prospectId) : getDb().prepare(sql).all(),
  );
}

export function updateMeeting(id: string, patch: {
  brief?: string | null;
  notes?: string | null;
  summary?: string | null;
  objections?: string | null;
  nextStep?: string | null;
  scheduledAt?: string | null;
}): MeetingRecord | null {
  ensureComercialSchema();
  const m = getMeeting(id);
  if (!m) return null;
  getDb().prepare(`
    UPDATE meetings SET
      brief = COALESCE(?, brief),
      notes = COALESCE(?, notes),
      summary = COALESCE(?, summary),
      objections = COALESCE(?, objections),
      next_step = COALESCE(?, next_step),
      scheduled_at = COALESCE(?, scheduled_at),
      updated_at = ?
    WHERE id = ?
  `).run(
    patch.brief ?? null, patch.notes ?? null, patch.summary ?? null,
    patch.objections ?? null, patch.nextStep ?? null, patch.scheduledAt ?? null,
    nowISO(), id,
  );
  return getMeeting(id);
}

// ─── Inbox (respostas classificadas) ─────────────────────────────────────────

export function ingestInbound(input: {
  prospectId: string;
  channel: string;
  body: string;
}): InboxRecord {
  ensureComercialSchema();
  const id = newId();
  getDb()
    .prepare("INSERT INTO inbox (id, prospect_id, channel, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, input.prospectId, input.channel, input.body, nowISO());
  // resposta recebida → prospect passa a "respondeu" (se não estiver adiante)
  const p = getProspect(input.prospectId);
  if (p && ["nao_contatado", "contatado"].includes(p.status)) {
    setProspectStatus(input.prospectId, "respondeu");
  }
  recordEvent("info", "inbox_ingested", { channel: input.channel }, input.prospectId);
  return getInboxItem(id)!;
}

export function getInboxItem(id: string): InboxRecord | null {
  ensureComercialSchema();
  return asRow<InboxRecord>(getDb().prepare("SELECT * FROM inbox WHERE id = ?").get(id));
}

export function listInbox(status?: InboxStatus, limit = 100): InboxRecord[] {
  ensureComercialSchema();
  const sql = status
    ? "SELECT * FROM inbox WHERE status = ? ORDER BY created_at DESC LIMIT ?"
    : "SELECT * FROM inbox ORDER BY created_at DESC LIMIT ?";
  return asRows<InboxRecord>(status ? getDb().prepare(sql).all(status, limit) : getDb().prepare(sql).all(limit));
}

export function setInboxStatus(id: string, status: InboxStatus): void {
  ensureComercialSchema();
  getDb().prepare("UPDATE inbox SET status = ? WHERE id = ?").run(status, id);
}

export function updateInboxClassification(id: string, intent: string, summary: string, suggestsMeeting: boolean): void {
  ensureComercialSchema();
  getDb().prepare("UPDATE inbox SET intent = ?, summary = ?, suggests_meeting = ?, status = 'lido' WHERE id = ?")
    .run(intent, summary, suggestsMeeting ? 1 : 0, id);
}

// ─── Métricas do dashboard (aquisição → comercial → financeiro) ──────────────

export function comercialCounters(): {
  deals: Record<DealStage, number>;
  dealValueCents: Record<DealStage, number>;
  wonCount: number;
  wonValueCents: number;
  meetingsTotal: number;
  inboxNew: number;
} {
  ensureComercialSchema();
  const d = getDb();
  const one = (sql: string, ...params: Array<string | number>): number =>
    Number((d.prepare(sql).get(...params) as { n: number }).n);
  const stages: DealStage[] = ["proposta", "negociacao", "ganho", "perdido"];
  const deals = Object.fromEntries(stages.map((s) => [s, one("SELECT COUNT(*) as n FROM deals WHERE stage = ?", s)])) as Record<DealStage, number>;
  const dealValueCents = Object.fromEntries(stages.map((s) => [s, one("SELECT COALESCE(SUM(value_cents),0) as n FROM deals WHERE stage = ?", s)])) as Record<DealStage, number>;
  return {
    deals,
    dealValueCents,
    wonCount: deals.ganho,
    wonValueCents: dealValueCents.ganho,
    meetingsTotal: one("SELECT COUNT(*) as n FROM meetings"),
    inboxNew: one("SELECT COUNT(*) as n FROM inbox WHERE status = 'novo'"),
  };
}
