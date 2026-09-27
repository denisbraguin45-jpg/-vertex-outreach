// ─── Marketing OS: pesquisa, calendário editorial, hooks, provas, criativos ──
// A IA transforma pesquisa em conteúdo; claims nunca extrapolam a prova real.

import { getDb, nowISO, newId } from "./index";
import { asRow, asRows } from "./rows";
import { ensureProspectSchema } from "./prospects";

export type ResearchKind = "dor" | "objecao" | "oferta_concorrente" | "angulo" | "hipotese";
export type CalendarStatus = "planejado" | "producao" | "publicado";
export type BriefKind = "hook" | "post" | "email" | "anuncio" | "roteiro_video" | "brief_imagem";

export interface ResearchEntry {
  id: string;
  market: string;
  kind: ResearchKind;
  content: string;
  source: string | null;
  created_at: string;
}

export interface CalendarItem {
  id: string;
  title: string;
  channel: string;
  planned_date: string | null;
  status: CalendarStatus;
  brief_id: string | null;
  created_at: string;
}

export interface BriefRecord {
  id: string;
  kind: BriefKind;
  title: string;
  audience: string | null;
  hook: string | null;
  message: string | null;
  proof: string | null;
  cta: string | null;
  format: string | null;
  compliance_note: string | null;
  content: string;
  created_at: string;
}

let migrated = false;

export function ensureMarketingSchema(): void {
  if (migrated) return;
  ensureProspectSchema();
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS marketing_research (
      id TEXT PRIMARY KEY,
      market TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('dor','objecao','oferta_concorrente','angulo','hipotese')),
      content TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mresearch_market ON marketing_research(market, kind);

    CREATE TABLE IF NOT EXISTS marketing_calendar (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      channel TEXT NOT NULL,
      planned_date TEXT,
      status TEXT NOT NULL DEFAULT 'planejado' CHECK (status IN ('planejado','producao','publicado')),
      brief_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS marketing_briefs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('hook','post','email','anuncio','roteiro_video','brief_imagem')),
      title TEXT NOT NULL,
      audience TEXT,
      hook TEXT,
      message TEXT,
      proof TEXT,
      cta TEXT,
      format TEXT,
      compliance_note TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  migrated = true;
}

// ─── Pesquisa ────────────────────────────────────────────────────────────────

export function addResearch(input: { market: string; kind: ResearchKind; content: string; source?: string | null }): ResearchEntry {
  ensureMarketingSchema();
  const id = newId();
  getDb()
    .prepare("INSERT INTO marketing_research (id, market, kind, content, source, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, input.market.trim(), input.kind, input.content.trim(), input.source ?? null, nowISO());
  return getResearch(id)!;
}

export function getResearch(id: string): ResearchEntry | null {
  ensureMarketingSchema();
  return asRow<ResearchEntry>(getDb().prepare("SELECT * FROM marketing_research WHERE id = ?").get(id));
}

export function listResearch(market?: string, kind?: ResearchKind): ResearchEntry[] {
  ensureMarketingSchema();
  const where: string[] = [];
  const params: string[] = [];
  if (market) { where.push("market = ?"); params.push(market); }
  if (kind) { where.push("kind = ?"); params.push(kind); }
  const sql = `SELECT * FROM marketing_research ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 300`;
  return asRows<ResearchEntry>(getDb().prepare(sql).all(...params));
}

export function deleteResearch(id: string): void {
  ensureMarketingSchema();
  getDb().prepare("DELETE FROM marketing_research WHERE id = ?").run(id);
}

// ─── Calendário editorial ────────────────────────────────────────────────────

export function addCalendarItem(input: { title: string; channel: string; plannedDate?: string | null; briefId?: string | null }): CalendarItem {
  ensureMarketingSchema();
  const id = newId();
  getDb()
    .prepare("INSERT INTO marketing_calendar (id, title, channel, planned_date, status, brief_id, created_at) VALUES (?, ?, ?, ?, 'planejado', ?, ?)")
    .run(id, input.title, input.channel, input.plannedDate ?? null, input.briefId ?? null, nowISO());
  return asRow<CalendarItem>(getDb().prepare("SELECT * FROM marketing_calendar WHERE id = ?").get(id))!;
}

export function listCalendar(): CalendarItem[] {
  ensureMarketingSchema();
  return asRows<CalendarItem>(getDb().prepare("SELECT * FROM marketing_calendar ORDER BY planned_date ASC, created_at DESC LIMIT 200").all());
}

export function setCalendarStatus(id: string, status: CalendarStatus): void {
  ensureMarketingSchema();
  getDb().prepare("UPDATE marketing_calendar SET status = ? WHERE id = ?").run(status, id);
}

// ─── Briefs / criativos ──────────────────────────────────────────────────────

export function saveBrief(input: {
  kind: BriefKind;
  title: string;
  audience?: string | null;
  hook?: string | null;
  message?: string | null;
  proof?: string | null;
  cta?: string | null;
  format?: string | null;
  complianceNote?: string | null;
  content: string;
}): BriefRecord {
  ensureMarketingSchema();
  const id = newId();
  getDb().prepare(`
    INSERT INTO marketing_briefs (id, kind, title, audience, hook, message, proof, cta, format, compliance_note, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.kind, input.title, input.audience ?? null, input.hook ?? null,
    input.message ?? null, input.proof ?? null, input.cta ?? null,
    input.format ?? null, input.complianceNote ?? null, input.content, nowISO(),
  );
  return getBrief(id)!;
}

export function getBrief(id: string): BriefRecord | null {
  ensureMarketingSchema();
  return asRow<BriefRecord>(getDb().prepare("SELECT * FROM marketing_briefs WHERE id = ?").get(id));
}

export function listBriefs(kind?: BriefKind): BriefRecord[] {
  ensureMarketingSchema();
  const sql = kind
    ? "SELECT * FROM marketing_briefs WHERE kind = ? ORDER BY created_at DESC LIMIT 200"
    : "SELECT * FROM marketing_briefs ORDER BY created_at DESC LIMIT 200";
  return asRows<BriefRecord>(kind ? getDb().prepare(sql).all(kind) : getDb().prepare(sql).all());
}

export function deleteBrief(id: string): void {
  ensureMarketingSchema();
  getDb().prepare("DELETE FROM marketing_briefs WHERE id = ?").run(id);
}

export function marketingCounters(): { research: number; briefs: number; calendar: number; published: number } {
  ensureMarketingSchema();
  const d = getDb();
  const one = (sql: string): number => Number((d.prepare(sql).get() as { n: number }).n);
  return {
    research: one("SELECT COUNT(*) as n FROM marketing_research"),
    briefs: one("SELECT COUNT(*) as n FROM marketing_briefs"),
    calendar: one("SELECT COUNT(*) as n FROM marketing_calendar"),
    published: one("SELECT COUNT(*) as n FROM marketing_calendar WHERE status = 'publicado'"),
  };
}
