// ─── Growth: delivery persistida, referral/proof, expansion, unit economics ──
// Módulos M e N do Growth OS. Expansion NUNCA sugere sem sinal real registrado.
// Money Model: receita inicial + recorrência + expansão + CAC/LTV/payback.

import { getDb, nowISO, newId, recordEvent } from "./index";
import { asRow, asRows } from "./rows";
import { ensureComercialSchema, type DealRecord } from "./comercial";
import { upsertProspect } from "./prospects";

// ─── Delivery (pipeline pós-venda persistido) ────────────────────────────────

export const DELIVERY_STAGES = [
  "VENDIDO", "ONBOARDING", "EM PRODUÇÃO", "REVISÃO", "PRONTO", "ENTREGUE", "RECORRÊNCIA",
] as const;
export type DeliveryStage = (typeof DELIVERY_STAGES)[number];

export interface DeliveryRecord {
  id: string;
  deal_id: string;
  prospect_id: string;
  stage: DeliveryStage;
  updated_at: string;
}

let migrated = false;

export function ensureGrowthSchema(): void {
  if (migrated) return;
  ensureComercialSchema();
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS delivery (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL UNIQUE,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      stage TEXT NOT NULL DEFAULT 'VENDIDO'
        CHECK (stage IN ('VENDIDO','ONBOARDING','EM PRODUÇÃO','REVISÃO','PRONTO','ENTREGUE','RECORRÊNCIA')),
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_stage ON delivery(stage);

    CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('depoimento','case','indicacao')),
      status TEXT NOT NULL DEFAULT 'solicitado'
        CHECK (status IN ('solicitado','recebido','publicado','recusado')),
      content TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expansion_signals (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      signal TEXT NOT NULL CHECK (signal IN ('novo_servico','automacao','manutencao','modulo','expansao_contrato')),
      detail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'detectada'
        CHECK (status IN ('detectada','oferecida','aceita','descartada')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spend (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      spent_at TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_spend_channel ON spend(channel, spent_at);
  `);
  // MRR: deals ganhos podem carregar recorrência mensal (migração aditiva)
  const cols = d.prepare("PRAGMA table_info(deals)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "recurrence_monthly_cents")) {
    d.exec("ALTER TABLE deals ADD COLUMN recurrence_monthly_cents INTEGER NOT NULL DEFAULT 0;");
  }
  migrated = true;
}

// ─── Delivery ────────────────────────────────────────────────────────────────

export function setDeliveryStage(dealId: string, stage: DeliveryStage): DeliveryRecord | null {
  ensureGrowthSchema();
  const deal = asRow<DealRecord>(getDb().prepare("SELECT * FROM deals WHERE id = ?").get(dealId));
  if (!deal) return null;
  getDb().prepare(`
    INSERT INTO delivery (id, deal_id, prospect_id, stage, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(deal_id) DO UPDATE SET stage = excluded.stage, updated_at = excluded.updated_at
  `).run(newId(), dealId, deal.prospect_id, stage, nowISO());
  return getDeliveryForDeal(dealId);
}

export function getDeliveryForDeal(dealId: string): DeliveryRecord | null {
  ensureGrowthSchema();
  return asRow<DeliveryRecord>(getDb().prepare("SELECT * FROM delivery WHERE deal_id = ?").get(dealId));
}

export function listDelivery(stage?: DeliveryStage): Array<DeliveryRecord & { company_name: string; deal_title: string; value_cents: number; recurrence_monthly_cents: number }> {
  ensureGrowthSchema();
  const sql = `
    SELECT d.*, p.company_name, dl.title as deal_title, dl.value_cents, dl.recurrence_monthly_cents
    FROM delivery d
    JOIN prospects p ON p.id = d.prospect_id
    JOIN deals dl ON dl.id = d.deal_id
    ${stage ? "WHERE d.stage = ?" : ""}
    ORDER BY d.updated_at DESC LIMIT 300
  `;
  return asRows<DeliveryRecord & { company_name: string; deal_title: string; value_cents: number; recurrence_monthly_cents: number }>(
    stage ? getDb().prepare(sql).all(stage) : getDb().prepare(sql).all(),
  );
}

// ─── Referral / Proof (N) ────────────────────────────────────────────────────

export function requestReferral(input: {
  prospectId: string;
  kind: "depoimento" | "case" | "indicacao";
  content?: string | null;
}): { id: string } {
  ensureGrowthSchema();
  const id = newId();
  getDb().prepare(
    "INSERT INTO referrals (id, prospect_id, kind, status, content, created_at, updated_at) VALUES (?, ?, ?, 'solicitado', ?, ?, ?)",
  ).run(id, input.prospectId, input.kind, input.content ?? null, nowISO(), nowISO());
  recordEvent("info", "referral_requested", { kind: input.kind }, input.prospectId);
  return { id };
}

export function updateReferral(id: string, status: "recebido" | "publicado" | "recusado", content?: string): void {
  ensureGrowthSchema();
  getDb().prepare("UPDATE referrals SET status = ?, content = COALESCE(?, content), updated_at = ? WHERE id = ?")
    .run(status, content ?? null, nowISO(), id);
}

export function listReferrals(prospectId?: string): Array<{
  id: string; prospect_id: string; kind: string; status: string; content: string | null; created_at: string; company_name: string;
}> {
  ensureGrowthSchema();
  const sql = `
    SELECT r.*, p.company_name FROM referrals r
    JOIN prospects p ON p.id = r.prospect_id
    ${prospectId ? "WHERE r.prospect_id = ?" : ""}
    ORDER BY r.created_at DESC LIMIT 200
  `;
  return asRows<{ id: string; prospect_id: string; kind: string; status: string; content: string | null; created_at: string; company_name: string }>(
    prospectId ? getDb().prepare(sql).all(prospectId) : getDb().prepare(sql).all(),
  );
}

/** Indicações recebidas viram prospects na base (fonte manual, não contatado). */
export function convertReferralToProspect(referralId: string, companyName: string): { prospectId: string } | null {
  ensureGrowthSchema();
  const referral = asRow<{ id: string; prospect_id: string; kind: string }>(
    getDb().prepare("SELECT * FROM referrals WHERE id = ?").get(referralId),
  );
  if (!referral || referral.kind !== "indicacao") return null;
  const { prospect } = upsertProspect({
    source: "manual",
    sourceId: `referral/${referralId}/${companyName.toLowerCase().replace(/\s+/g, "-")}`,
    companyName,
  });
  recordEvent("info", "referral_converted", { referralId, prospectId: prospect.id }, referral.prospect_id);
  return { prospectId: prospect.id };
}

// ─── Expansion (M) — somente com sinal real ──────────────────────────────────

export const EXPANSION_SIGNALS = ["novo_servico", "automacao", "manutencao", "modulo", "expansao_contrato"] as const;
export type ExpansionSignal = (typeof EXPANSION_SIGNALS)[number];

export function addExpansionSignal(input: { prospectId: string; signal: ExpansionSignal; detail: string }): { id: string } | null {
  ensureGrowthSchema();
  if (!input.detail.trim()) return null; // exige detalhe real, sem invenção
  const id = newId();
  getDb().prepare(
    "INSERT INTO expansion_signals (id, prospect_id, signal, detail, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, input.prospectId, input.signal, input.detail.trim(), nowISO());
  recordEvent("info", "expansion_signal", { signal: input.signal }, input.prospectId);
  return { id };
}

export function listExpansionSignals(status?: "detectada" | "oferecida" | "aceita" | "descartada"): Array<{
  id: string; prospect_id: string; signal: string; detail: string; status: string; created_at: string; company_name: string;
}> {
  ensureGrowthSchema();
  const where = status ? "WHERE e.status = ?" : "";
  const sql = `
    SELECT e.*, p.company_name FROM expansion_signals e
    JOIN prospects p ON p.id = e.prospect_id
    ${where}
    ORDER BY e.created_at DESC LIMIT 200
  `;
  return asRows<{ id: string; prospect_id: string; signal: string; detail: string; status: string; created_at: string; company_name: string }>(
    status ? getDb().prepare(sql).all(status) : getDb().prepare(sql).all(),
  );
}

export function setExpansionStatus(id: string, status: "detectada" | "oferecida" | "aceita" | "descartada"): void {
  ensureGrowthSchema();
  getDb().prepare("UPDATE expansion_signals SET status = ? WHERE id = ?").run(status, id);
}

// ─── Spend (CAC por canal) ───────────────────────────────────────────────────

export function addSpend(input: { channel: string; amountCents: number; note?: string | null; spentAt?: string }): void {
  ensureGrowthSchema();
  getDb().prepare(
    "INSERT INTO spend (id, channel, amount_cents, spent_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(newId(), input.channel, Math.max(0, Math.round(input.amountCents)), input.spentAt ?? nowISO().slice(0, 10), input.note ?? null, nowISO());
}

// ─── Money Model: receita, MRR, CAC, LTV, payback ────────────────────────────

export interface MoneyModelSnapshot {
  revenueInitialCents: number;
  mrrCents: number;
  expansionCents: number;
  cacCents: number | null;
  cacByChannelCents: Record<string, number>;
  ltvCents: number | null;
  paybackMonths: number | null;
}

export function moneyModel(): MoneyModelSnapshot {
  ensureGrowthSchema();
  const d = getDb();
  const one = (sql: string, ...params: Array<string | number>): number =>
    Number((d.prepare(sql).get(...params) as { n: number }).n);

  const revenueInitialCents = one("SELECT COALESCE(SUM(value_cents),0) as n FROM deals WHERE stage = 'ganho'");
  const mrrCents = one("SELECT COALESCE(SUM(recurrence_monthly_cents),0) as n FROM deals WHERE stage = 'ganho'");
  const wonCount = one("SELECT COUNT(*) as n FROM deals WHERE stage = 'ganho'");

  const totalSpendCents = one("SELECT COALESCE(SUM(amount_cents),0) as n FROM spend");
  const cacCents = wonCount > 0 ? Math.round(totalSpendCents / wonCount) : null;

  const cacByChannelCents: Record<string, number> = {};
  for (const row of asRows<{ channel: string; n: number }>(
    d.prepare("SELECT channel, COALESCE(SUM(amount_cents),0) as n FROM spend GROUP BY channel").all(),
  )) {
    cacByChannelCents[row.channel] = row.n;
  }

  const avgTicket = wonCount > 0 ? Math.round(revenueInitialCents / wonCount) : 0;
  const avgMrr = wonCount > 0 ? Math.round(mrrCents / wonCount) : 0;
  const ltvCents = wonCount > 0 ? avgTicket + avgMrr * 6 : null; // horizonte 6 meses, conservador
  const monthlyMargin = avgTicket + avgMrr;
  const paybackMonths = cacCents !== null && monthlyMargin > 0 ? Math.round((cacCents / monthlyMargin) * 10) / 10 : null;

  return { revenueInitialCents, mrrCents, expansionCents: 0, cacCents, cacByChannelCents, ltvCents, paybackMonths };
}

export function growthCounters(): {
  deliveryByStage: Record<string, number>;
  referralsOpen: number;
  referralsPublished: number;
  expansionsOpen: number;
  expansionsAccepted: number;
} {
  ensureGrowthSchema();
  const d = getDb();
  const one = (sql: string): number => Number((d.prepare(sql).get() as { n: number }).n);
  const deliveryByStage: Record<string, number> = {};
  for (const row of asRows<{ stage: string; n: number }>(
    d.prepare("SELECT stage, COUNT(*) as n FROM delivery GROUP BY stage").all(),
  )) {
    deliveryByStage[row.stage] = row.n;
  }
  return {
    deliveryByStage,
    referralsOpen: one("SELECT COUNT(*) as n FROM referrals WHERE status = 'solicitado'"),
    referralsPublished: one("SELECT COUNT(*) as n FROM referrals WHERE status = 'publicado'"),
    expansionsOpen: one("SELECT COUNT(*) as n FROM expansion_signals WHERE status = 'detectada'"),
    expansionsAccepted: one("SELECT COUNT(*) as n FROM expansion_signals WHERE status = 'aceita'"),
  };
}
