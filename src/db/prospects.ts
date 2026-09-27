// ─── Prospecting module: base de contatos multicanal (node:sqlite) ──────────
// Tabelas: prospects (base bruta de empresas), message_templates (compose
// manual do operador), outreach_log (acompanhamento de disparos).
// Fonte de coleta: Nominatim + Overpass (OSM, grátis) e Google Places
// (opcional via GOOGLE_PLACES_API_KEY). Sem qualificação comercial.

import { getDb, nowISO, newId } from "./index";
import { asRow, asRows } from "./rows";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Estados de acompanhamento do contato (internal English, UI PT-BR). */
export type ProspectStatus =
  | "nao_contatado"
  | "contatado"
  | "respondeu"
  | "interessado"
  | "sem_interesse"
  | "opt_out";

export const PROSPECT_STATUSES: ProspectStatus[] = [
  "nao_contatado",
  "contatado",
  "respondeu",
  "interessado",
  "sem_interesse",
  "opt_out",
];

/** Fluxo simples: só proíbe voltar para nao_contatado e mexer em opt_out. */
const STATUS_FLOW: Record<ProspectStatus, ProspectStatus[]> = {
  nao_contatado: ["contatado", "respondeu", "interessado", "sem_interesse", "opt_out"],
  contatado: ["respondeu", "interessado", "sem_interesse", "opt_out", "contatado"],
  respondeu: ["interessado", "sem_interesse", "opt_out", "contatado", "respondeu"],
  interessado: ["sem_interesse", "opt_out", "interessado", "contatado"],
  sem_interesse: ["opt_out", "contatado", "sem_interesse"],
  opt_out: ["opt_out"],
};

export interface ProspectRecord {
  id: string;
  source: "osm" | "google_places" | "manual";
  source_id: string;
  company_name: string;
  niche: string | null;
  category: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  instagram: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  google_maps_url: string | null;
  google_rating: number | null;
  google_reviews_count: number | null;
  status: ProspectStatus;
  notes: string | null;
  last_contacted_at: string | null;
  last_channel: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageTemplateRecord {
  id: string;
  name: string;
  channel: "whatsapp" | "email" | "instagram" | "universal";
  subject: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface OutreachLogRecord {
  id: string;
  prospect_id: string;
  channel: "whatsapp" | "email" | "instagram";
  template_id: string | null;
  subject: string | null;
  body: string;
  status: "registrado" | "falha";
  detail: string | null;
  created_at: string;
}

export interface ProspectFilters {
  search?: string;
  niche?: string;
  city?: string;
  state?: string;
  hasWhatsapp?: boolean;
  hasEmail?: boolean;
  hasInstagram?: boolean;
  hasSite?: boolean;
  noSite?: boolean;
  status?: ProspectStatus;
  limit?: number;
  offset?: number;
}

// ─── Migration (idempotent, called from getDb via ensureProspectSchema) ──────

let migrated = false;

export function ensureProspectSchema(): void {
  if (migrated) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS prospects (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('osm','google_places','manual')),
      source_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      niche TEXT,
      category TEXT,
      phone TEXT,
      whatsapp TEXT,
      email TEXT,
      instagram TEXT,
      website TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      google_maps_url TEXT,
      google_rating REAL,
      google_reviews_count INTEGER,
      status TEXT NOT NULL DEFAULT 'nao_contatado'
        CHECK (status IN ('nao_contatado','contatado','respondeu','interessado','sem_interesse','opt_out')),
      notes TEXT,
      last_contacted_at TEXT,
      last_channel TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- uma entrada por fonte: coleta repetida nunca duplica a base
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prospects_unique ON prospects(source, source_id);
    CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
    CREATE INDEX IF NOT EXISTS idx_prospects_city ON prospects(city);
    CREATE INDEX IF NOT EXISTS idx_prospects_niche ON prospects(niche);

    CREATE TABLE IF NOT EXISTS message_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email','instagram','universal')),
      subject TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outreach_log (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email','instagram')),
      template_id TEXT,
      subject TEXT,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'registrado' CHECK (status IN ('registrado','falha')),
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_outreach_log_prospect ON outreach_log(prospect_id, created_at);
  `);
  migrated = true;
}

// ─── Upsert / CRUD ───────────────────────────────────────────────────────────

export interface UpsertProspectInput {
  source: ProspectRecord["source"];
  sourceId: string;
  companyName: string;
  niche?: string | null;
  category?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  instagram?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  googleMapsUrl?: string | null;
  googleRating?: number | null;
  googleReviewsCount?: number | null;
}

/**
 * Idempotente: coleta repetida atualiza canais vazios sem tocar em
 * status/notas. Empresas opt_out nunca são re-inseridas.
 */
export function upsertProspect(input: UpsertProspectInput): { prospect: ProspectRecord; created: boolean } {
  ensureProspectSchema();
  const d = getDb();
  const existing = asRow<ProspectRecord>(
    d.prepare("SELECT * FROM prospects WHERE source = ? AND source_id = ?").get(input.source, input.sourceId),
  );

  if (existing) {
    if (existing.status === "opt_out") return { prospect: existing, created: false };
    d.prepare(`
      UPDATE prospects SET
        company_name = CASE WHEN ? <> '' THEN ? ELSE company_name END,
        category = COALESCE(?, category),
        phone = COALESCE(phone, ?),
        whatsapp = COALESCE(whatsapp, ?),
        email = COALESCE(email, ?),
        instagram = COALESCE(instagram, ?),
        website = COALESCE(website, ?),
        address = COALESCE(address, ?),
        city = COALESCE(city, ?),
        state = COALESCE(state, ?),
        google_maps_url = COALESCE(google_maps_url, ?),
        google_rating = COALESCE(google_rating, ?),
        google_reviews_count = COALESCE(google_reviews_count, ?),
        updated_at = ?
      WHERE id = ?
    `).run(
      input.companyName, input.companyName,
      input.category ?? null,
      input.phone ?? null, input.whatsapp ?? null, input.email ?? null,
      input.instagram ?? null, input.website ?? null, input.address ?? null,
      input.city ?? null, input.state ?? null,
      input.googleMapsUrl ?? null,
      input.googleRating ?? null, input.googleReviewsCount ?? null,
      nowISO(), existing.id,
    );
    return { prospect: getProspect(existing.id)!, created: false };
  }

  const id = newId();
  d.prepare(`
    INSERT INTO prospects (id, source, source_id, company_name, niche, category,
      phone, whatsapp, email, instagram, website, address, city, state,
      google_maps_url, google_rating, google_reviews_count, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nao_contatado', ?, ?)
  `).run(
    id, input.source, input.sourceId, input.companyName,
    input.niche ?? null, input.category ?? null,
    input.phone ?? null, input.whatsapp ?? null, input.email ?? null,
    input.instagram ?? null, input.website ?? null, input.address ?? null,
    input.city ?? null, input.state ?? null,
    input.googleMapsUrl ?? null, input.googleRating ?? null, input.googleReviewsCount ?? null,
    nowISO(), nowISO(),
  );
  return { prospect: getProspect(id)!, created: true };
}

export function getProspect(id: string): ProspectRecord | null {
  return asRow<ProspectRecord>(getDb().prepare("SELECT * FROM prospects WHERE id = ?").get(id));
}

export function deleteProspects(ids: string[]): number {
  ensureProspectSchema();
  if (!ids.length) return 0;
  const d = getDb();
  let removed = 0;
  const stmt = d.prepare("DELETE FROM prospects WHERE id = ?");
  for (const id of ids) {
    removed += Number(stmt.run(id).changes);
  }
  return removed;
}

// ─── Listagem + filtros ──────────────────────────────────────────────────────

type SqlParam = string | number | null;

export function listProspects(filters: ProspectFilters = {}): ProspectRecord[] {
  ensureProspectSchema();
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (filters.search) {
    where.push("(company_name LIKE ? OR instagram LIKE ? OR email LIKE ? OR phone LIKE ? OR whatsapp LIKE ?)");
    const like = `%${filters.search}%`;
    params.push(like, like, like, like, like);
  }
  if (filters.niche) { where.push("niche = ?"); params.push(filters.niche); }
  if (filters.city) { where.push("city LIKE ?"); params.push(`%${filters.city}%`); }
  if (filters.state) { where.push("state = ?"); params.push(filters.state.toUpperCase()); }
  if (filters.hasWhatsapp) where.push("whatsapp IS NOT NULL AND whatsapp <> ''");
  if (filters.hasEmail) where.push("email IS NOT NULL AND email <> ''");
  if (filters.hasInstagram) where.push("instagram IS NOT NULL AND instagram <> ''");
  if (filters.hasSite) where.push("website IS NOT NULL AND website <> ''");
  if (filters.noSite) where.push("(website IS NULL OR website = '')");
  if (filters.status) { where.push("status = ?"); params.push(filters.status); }

  const sql = `
    SELECT * FROM prospects
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC, company_name COLLATE NOCASE ASC
    LIMIT ? OFFSET ?
  `;
  params.push(filters.limit ?? 200, filters.offset ?? 0);
  return asRows<ProspectRecord>(getDb().prepare(sql).all(...params));
}

export function countProspects(filters: ProspectFilters = {}): number {
  ensureProspectSchema();
  // reaproveita os mesmos predicados da listagem
  const rows = listProspects({ ...filters, limit: 1_000_000, offset: 0 });
  return rows.length;
}

/** Contadores por status + presença de canal (badges da UI). */
export function prospectCounters(): {
  total: number;
  byStatus: Record<ProspectStatus, number>;
  withWhatsapp: number;
  withEmail: number;
  withInstagram: number;
  withSite: number;
} {
  ensureProspectSchema();
  const d = getDb();
  const one = (sql: string): number => Number((d.prepare(sql).get() as { n: number }).n);
  const byStatus = Object.fromEntries(
    PROSPECT_STATUSES.map((s) => [s, one(`SELECT COUNT(*) as n FROM prospects WHERE status = '${s}'`)]),
  ) as Record<ProspectStatus, number>;
  return {
    total: one("SELECT COUNT(*) as n FROM prospects"),
    byStatus,
    withWhatsapp: one("SELECT COUNT(*) as n FROM prospects WHERE whatsapp IS NOT NULL AND whatsapp <> ''"),
    withEmail: one("SELECT COUNT(*) as n FROM prospects WHERE email IS NOT NULL AND email <> ''"),
    withInstagram: one("SELECT COUNT(*) as n FROM prospects WHERE instagram IS NOT NULL AND instagram <> ''"),
    withSite: one("SELECT COUNT(*) as n FROM prospects WHERE website IS NOT NULL AND website <> ''"),
  };
}

export function listNiches(): string[] {
  ensureProspectSchema();
  return (getDb().prepare("SELECT DISTINCT niche FROM prospects WHERE niche IS NOT NULL ORDER BY niche").all() as Array<{ niche: string }>).map((r) => r.niche);
}

// ─── Status / notas ──────────────────────────────────────────────────────────

export function setProspectStatus(id: string, status: ProspectStatus): ProspectRecord | null {
  ensureProspectSchema();
  const prospect = getProspect(id);
  if (!prospect) return null;
  const allowed = STATUS_FLOW[prospect.status] ?? [];
  if (!allowed.includes(status)) return null;
  getDb().prepare("UPDATE prospects SET status = ?, updated_at = ? WHERE id = ?").run(status, nowISO(), id);
  return getProspect(id);
}

export function appendProspectNote(id: string, note: string): void {
  ensureProspectSchema();
  const prospect = getProspect(id);
  if (!prospect) return;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const updated = `${prospect.notes ? prospect.notes + "\n" : ""}[${stamp}] ${note}`;
  getDb().prepare("UPDATE prospects SET notes = ?, updated_at = ? WHERE id = ?").run(updated, nowISO(), id);
}

/** Marca contato feito agora (chamado ao disparar/registrar um envio). */
export function markContacted(id: string, channel: OutreachLogRecord["channel"]): void {
  ensureProspectSchema();
  const d = getDb();
  const prospect = getProspect(id);
  if (!prospect || prospect.status === "opt_out") return;
  if (prospect.status === "nao_contatado") {
    d.prepare("UPDATE prospects SET status = 'contatado', last_contacted_at = ?, last_channel = ?, updated_at = ? WHERE id = ?")
      .run(nowISO(), channel, nowISO(), id);
  } else {
    d.prepare("UPDATE prospects SET last_contacted_at = ?, last_channel = ?, updated_at = ? WHERE id = ?")
      .run(nowISO(), channel, nowISO(), id);
  }
}

// ─── Templates (compose) ─────────────────────────────────────────────────────

export function saveTemplate(input: {
  id?: string;
  name: string;
  channel: MessageTemplateRecord["channel"];
  subject?: string | null;
  body: string;
}): MessageTemplateRecord {
  ensureProspectSchema();
  const d = getDb();
  const now = nowISO();
  if (input.id) {
    d.prepare("UPDATE message_templates SET name = ?, channel = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?")
      .run(input.name, input.channel, input.subject ?? null, input.body, now, input.id);
  } else {
    const id = newId();
    d.prepare("INSERT INTO message_templates (id, name, channel, subject, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.name, input.channel, input.subject ?? null, input.body, now, now);
  }
  const id = input.id ?? (d.prepare("SELECT id FROM message_templates ORDER BY created_at DESC LIMIT 1").get() as { id: string }).id;
  return asRow<MessageTemplateRecord>(d.prepare("SELECT * FROM message_templates WHERE id = ?").get(id))!;
}

export function listTemplates(): MessageTemplateRecord[] {
  ensureProspectSchema();
  return asRows<MessageTemplateRecord>(
    getDb().prepare("SELECT * FROM message_templates ORDER BY updated_at DESC").all(),
  );
}

export function getTemplate(id: string): MessageTemplateRecord | null {
  ensureProspectSchema();
  return asRow<MessageTemplateRecord>(getDb().prepare("SELECT * FROM message_templates WHERE id = ?").get(id));
}

export function deleteTemplate(id: string): void {
  ensureProspectSchema();
  getDb().prepare("DELETE FROM message_templates WHERE id = ?").run(id);
}

// ─── Log de disparos (acompanhar) ────────────────────────────────────────────

export function recordOutreach(input: {
  prospectId: string;
  channel: OutreachLogRecord["channel"];
  templateId?: string | null;
  subject?: string | null;
  body: string;
  status?: OutreachLogRecord["status"];
  detail?: string | null;
}): OutreachLogRecord {
  ensureProspectSchema();
  const id = newId();
  getDb().prepare(
    "INSERT INTO outreach_log (id, prospect_id, channel, template_id, subject, body, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id, input.prospectId, input.channel, input.templateId ?? null,
    input.subject ?? null, input.body,
    input.status ?? "registrado", input.detail ?? null, nowISO(),
  );
  if ((input.status ?? "registrado") === "registrado") {
    markContacted(input.prospectId, input.channel);
  }
  return asRow<OutreachLogRecord>(getDb().prepare("SELECT * FROM outreach_log WHERE id = ?").get(id))!;
}

export function outreachLogFor(prospectId: string, limit = 50): OutreachLogRecord[] {
  ensureProspectSchema();
  return asRows<OutreachLogRecord>(
    getDb().prepare("SELECT * FROM outreach_log WHERE prospect_id = ? ORDER BY created_at DESC LIMIT ?").all(prospectId, limit),
  );
}

/** Últimos disparos entre todos os prospects (aba Acompanhar). */
export function recentOutreach(limit = 50): Array<OutreachLogRecord & { company_name: string }> {
  ensureProspectSchema();
  return asRows<OutreachLogRecord & { company_name: string }>(
    getDb().prepare(`
      SELECT o.*, p.company_name FROM outreach_log o
      JOIN prospects p ON p.id = o.prospect_id
      ORDER BY o.created_at DESC LIMIT ?
    `).all(limit),
  );
}

export function outreachCounters(): { today: number; total: number; byChannel: Record<string, number> } {
  ensureProspectSchema();
  const d = getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const one = (sql: string, ...params: SqlParam[]): number =>
    Number((d.prepare(sql).get(...params) as { n: number }).n);
  const byChannel: Record<string, number> = {};
  for (const row of asRows<{ channel: string; n: number }>(
    d.prepare("SELECT channel, COUNT(*) as n FROM outreach_log GROUP BY channel").all(),
  )) {
    byChannel[row.channel] = row.n;
  }
  return {
    today: one("SELECT COUNT(*) as n FROM outreach_log WHERE created_at >= ?", startOfDay.toISOString()),
    total: one("SELECT COUNT(*) as n FROM outreach_log"),
    byChannel,
  };
}
