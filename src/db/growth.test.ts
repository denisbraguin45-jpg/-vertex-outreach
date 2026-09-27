// ─── Growth tests: delivery, referral, expansion gating, money model ────────
// Run: npm test (node:test + tsx)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), "outreach-growth-")), "test.db");
delete process.env.OPENAI_API_KEY;

const { getDb } = await import("./index");
const { ensureProspectSchema, upsertProspect, listProspects } = await import("./prospects");
const { createDeal, setDealStage } = await import("./comercial");
const {
  ensureGrowthSchema, setDeliveryStage, getDeliveryForDeal, DELIVERY_STAGES,
  requestReferral, updateReferral, listReferrals, convertReferralToProspect,
  addExpansionSignal, listExpansionSignals, setExpansionStatus,
  addSpend, moneyModel, growthCounters,
} = await import("./growth");

function cleanDb() {
  ensureGrowthSchema();
  getDb().exec("DELETE FROM delivery; DELETE FROM referrals; DELETE FROM expansion_signals; DELETE FROM spend; DELETE FROM deals; DELETE FROM meetings; DELETE FROM inbox; DELETE FROM prospects; DELETE FROM events;");
}

beforeEach(() => cleanDb());

function setupDeal(valueCents = 500_000, recurrence = 100_000) {
  const { prospect } = upsertProspect({ source: "manual", sourceId: `m/${Math.random()}`, companyName: "Cliente SA" });
  const deal = createDeal({ prospectId: prospect.id, title: "Prop", valueCents });
  setDealStage(deal.id, "ganho");
  getDb().prepare("UPDATE deals SET recurrence_monthly_cents = ? WHERE id = ?").run(recurrence, deal.id);
  return { prospect, deal };
}

test("delivery: stage persisted, one row per deal (upsert)", () => {
  const { deal } = setupDeal();
  assert.ok(setDeliveryStage(deal.id, "ONBOARDING"));
  assert.equal(getDeliveryForDeal(deal.id)?.stage, "ONBOARDING");
  setDeliveryStage(deal.id, "EM PRODUÇÃO");
  const rec = getDeliveryForDeal(deal.id);
  assert.equal(rec?.stage, "EM PRODUÇÃO");
  // apenas uma linha por deal (unique)
  const rows = getDb().prepare("SELECT COUNT(*) as n FROM delivery WHERE deal_id = ?").get(deal.id) as { n: number };
  assert.equal(rows.n, 1);
  assert.ok(DELIVERY_STAGES.includes("RECORRÊNCIA"));
});

test("referral: request → received → convert indication into prospect", () => {
  const { prospect } = upsertProspect({ source: "manual", sourceId: "m/ref", companyName: "Fonte LTDA" });
  const { id } = requestReferral({ prospectId: prospect.id, kind: "indicacao" });
  updateReferral(id, "recebido");
  const converted = convertReferralToProspect(id, "Empresa Indicada ME");
  assert.ok(converted);
  const found = listProspects({ search: "Empresa Indicada" });
  assert.equal(found.length, 1);
  assert.equal(found[0].status, "nao_contatado");
  void listReferrals;
});

test("expansion: signal without detail is rejected (no invented opportunities)", () => {
  const { prospect } = upsertProspect({ source: "manual", sourceId: "m/exp", companyName: "UpSell SA" });
  assert.equal(addExpansionSignal({ prospectId: prospect.id, signal: "automacao", detail: "   " }), null);
  addExpansionSignal({ prospectId: prospect.id, signal: "automacao", detail: "Pede relatório semanal no suporte" });
  assert.equal(listExpansionSignals("detectada").length, 1);
  const [sig] = listExpansionSignals("detectada");
  setExpansionStatus(sig.id, "aceita");
  assert.equal(listExpansionSignals("detectada").length, 0);
  assert.equal(listExpansionSignals("aceita").length, 1);
});

test("money model: CAC, MRR, LTV and payback computed from real rows", () => {
  // 2 vendas de R$5.000 + R$1.000 MRR cada; spend total R$2.000 → CAC R$1.000
  setupDeal(500_000, 100_000);
  setupDeal(500_000, 100_000);
  addSpend({ channel: "instagram", amountCents: 150_000 });
  addSpend({ channel: "email", amountCents: 50_000 });

  const m = moneyModel();
  assert.equal(m.revenueInitialCents, 1_000_000);
  assert.equal(m.mrrCents, 200_000);
  assert.equal(m.cacCents, 100_000); // 200.000 spend / 2 vendas
  assert.equal(m.cacByChannelCents["instagram"], 150_000);
  // LTV = ticket 500.000 + MRR médio 100.000 * 6
  assert.equal(m.ltvCents, 1_100_000);
  // payback = CAC 100.000 / (500.000 + 100.000) = 0.166 → 0.2
  assert.equal(m.paybackMonths, 0.2);

  const c = growthCounters();
  assert.equal(c.expansionsAccepted, 0);
});
