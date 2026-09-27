// ─── Intelligence tests: classification heuristics, score bounds ────────────
// Run: npm test (node:test + tsx)

import { test } from "node:test";
import assert from "node:assert/strict";

// Sem OpenAI configurada no teste → sempre usa heurística determinística
delete process.env.OPENAI_API_KEY;
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "unused-growth-test.db";

const { classifyReplyHeuristic, computeLeadScore, suggestNextAction } = await import("./ai");

test("classify heuristic: opt-out has top priority", () => {
  const r = classifyReplyHeuristic("Podem me remover dessa lista, não quero receber mais nada");
  assert.equal(r.intent, "opt_out");
  assert.equal(r.suggestsMeeting, false);
});

test("classify heuristic: pricing question", () => {
  const r = classifyReplyHeuristic("Bom dia! Quanto custa o plano para 3 usuários?");
  assert.equal(r.intent, "pediu_preco");
});

test("classify heuristic: meeting interest", () => {
  const r = classifyReplyHeuristic("Interessante, podemos marcar uma chamada essa semana?");
  assert.equal(r.intent, "interesse");
  assert.equal(r.suggestsMeeting, true);
});

test("classify heuristic: not the decision maker", () => {
  const r = classifyReplyHeuristic("Quem cuida disso é o meu sócio, fale com ele");
  assert.equal(r.intent, "nao_eh_decisor");
});

test("classify heuristic: no interest / objection", () => {
  const r = classifyReplyHeuristic("Obrigado, mas já temos um sistema e estamos satisfeitos");
  assert.equal(r.intent, "sem_interesse");
});

test("classify heuristic: ambiguous fallback", () => {
  const r = classifyReplyHeuristic("kk");
  assert.equal(r.intent, "ambigua");
});

test("score: within 0-100 and weights change result", () => {
  const low = computeLeadScore({ fitFinanceiro: 1, potencialOferta: 1, dorOportunidade: 1, interesse: 1, autoridade: 1, timing: 1 });
  const high = computeLeadScore({ fitFinanceiro: 10, potencialOferta: 10, dorOportunidade: 10, interesse: 10, autoridade: 10, timing: 10 });
  assert.equal(low.score >= 0, true);
  assert.equal(high.score, 100);
  // sem interesse, score cai muito mesmo com fit alto (interesse tem o maior peso)
  const cold = computeLeadScore({ fitFinanceiro: 10, potencialOferta: 8, dorOportunidade: 7, interesse: 1, autoridade: 5, timing: 3 });
  assert.equal(cold.score < high.score - 30, true);
});

test("next action: opt-out blocks everything else", async () => {
  const action = await suggestNextAction({ companyName: "X", status: "contatado", intent: "opt_out", notes: null });
  assert.match(action, /[Oo]pt-out/);
});
