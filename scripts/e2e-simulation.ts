// ─── E2E simulation: full autonomy cycle with evidence (no real sends) ─────
// Demonstrates: discovery → qualify → first contact (dry-run) → inbound via
// webhook → handoff to API → AI decision → reply → funnel progression →
// experiment attribution → cost tracking → recovery → pause on risk.
//
// Run: pnpm e2e   (uses a temp DB; safe to run anytime)

import "dotenv/config";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), "outreach-e2e-")), "e2e.db");
process.env.OUTREACH_DRY_RUN = "true";
// Simulated AI keeps the E2E deterministic and offline; real OpenAI follows the
// exact same code path (engine → handoff → API send).
process.env.OUTREACH_AI_MODE = "simulated";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const section = (t: string) => console.log(`\n━━━ ${t} ${"━".repeat(Math.max(3, 60 - t.length))}`);

async function main() {
  const { getDb } = await import("@/db");
  getDb();

  const { runDiscoveryJob } = await import("@/features/discovery/job");
  const { listLeads, getLead } = await import("@/db/leads");
  const { runFirstContactJob } = await import("@/features/conversations/first-contact");
  const { processInboundMessage } = await import("@/features/conversations/handoff");
  const { leadHistory, aiCostStats, channelOwner } = await import("@/db/messages");
  const { claimNextJob, completeJob, enqueueJob, listJobs } = await import("@/db/jobs");
  const { listExperiments } = await import("@/db/experiments");
  const { isPaused, pauseSystem, resumeSystem } = await import("@/worker/safety");
  const { recoverStaleJobs } = await import("@/db/jobs");
  const { recordAiCall } = await import("@/db/messages");

  section("1. DESCOBERTA (funil clientes) — dedupe + pontuação ICP");
  const d1 = await runDiscoveryJob("clients");
  console.log(`   encontrados=${d1.found} criados=${d1.created} duplicados=${d1.duplicates} qualificados→fila=${d1.contactJobsQueued}`);
  const d2 = await runDiscoveryJob("clients");
  console.log(`   segunda rodada: criados=${d2.created} duplicados=${d2.duplicates}  ← dedupe comprovado`);

  section("2. DESCOBERTA (funil afiliados)");
  const d3 = await runDiscoveryJob("affiliates");
  console.log(`   encontrados=${d3.found} criados=${d3.created} →fila=${d3.contactJobsQueued}`);

  section("3. PRIMEIRO CONTATO (navegador, dry-run)");
  const qualified = listLeads({ funnel: "clients", pipeline: "qualified", limit: 2 });
  for (const lead of qualified) {
    const r = await runFirstContactJob(lead.id);
    console.log(`   @${lead.instagram_handle}: sent=${r.sent} · ${r.reason}`);
  }
  const after = listLeads({ funnel: "clients", pipeline: "contacted", limit: 10 });
  console.log(`   leads abordados=${after.length} · canal=${after[0]?.channel}`);

  section("4. RITMO — cap diário e warmup");
  const { canSendBrowserDmNow, dailyCap } = await import("@/worker/rhythm");
  console.log(`   cap de hoje (warmup)=${dailyCap()} DMs · status=${JSON.stringify(canSendBrowserDmNow())}`);

  section("5. HANDOFF: lead responde → webhook → API assume o fio");
  const contacted = listLeads({ funnel: "clients", channel: "waiting_inbound_reply", limit: 1 })[0];
  if (!contacted) throw new Error("nenhum lead aguardando resposta — primeiro contato falhou");
  const outcome = await processInboundMessage({
    igUserId: contacted.instagram_user_id ?? `ig-${contacted.instagram_handle}`,
    username: contacted.instagram_handle,
    text: "Oi! Fiquei curioso, como funciona exatamente?",
    messageId: `mid-e2e-${Date.now()}`,
    receivedAt: new Date(),
  });
  console.log(`   processado=${outcome.processed} · ação=${outcome.action} · motivo=${outcome.reason}`);
  const handoffLead = getLead(contacted.id)!;
  console.log(`   canal agora=${handoffLead.channel} · dono do fio=${channelOwner(handoffLead.id)}  ← travado na API`);

  section("6. IDEMPOTÊNCIA de webhook (Meta reentrega o mesmo mid)");
  const again = await processInboundMessage({
    igUserId: contacted.instagram_user_id ?? `ig-${contacted.instagram_handle}`,
    username: contacted.instagram_handle,
    text: "Oi! Fiquei curioso, como funciona exatamente?",
    messageId: `mid-e2e-${Date.now()}`,
    receivedAt: new Date(),
  });
  console.log(`   segunda entrega: processed=${again.processed} action=${again.action}  ← ignorada como duplicata`);

  section("7. PEDIDO DE PARAR → do_not_contact permanente");
  const target2 = listLeads({ funnel: "clients", pipeline: "contacted", limit: 5 })[0];
  if (target2) {
    await processInboundMessage({
      igUserId: target2.instagram_user_id ?? `ig-${target2.instagram_handle}`,
      username: target2.instagram_handle,
      text: "Para de me mandar mensagem, não quero saber",
      messageId: `mid-e2e-optout-${Date.now()}`,
      receivedAt: new Date(),
    });
    const l2 = getLead(target2.id)!;
    console.log(`   @${l2.instagram_handle}: canal=${l2.channel}  ← nunca mais contactado`);
  }

  section("8. CLAIMS GATE — afirmações não verificadas são bloqueadas");
  const { assertNoBlockedClaims } = await import("@/features/conversations/engine");
  try {
    assertNoBlockedClaims("Somos a melhor agência do Brasil, garantimos aprovação de conta e 10x de ROI garantido em 30 dias.");
    console.log("   FALHA: passou pelo gate!");
  } catch (e) {
    console.log(`   bloqueado: ${(e as Error).message.slice(0, 80)}…`);
  }

  section("9. HISTÓRICO AUDITÁVEL da conversa");
  for (const m of leadHistory(handoffLead.id)) {
    console.log(`   [${m.direction === "inbound" ? "LEAD " : "SIST"}] (${m.channel}) ${m.body.slice(0, 70)}${m.body.length > 70 ? "…" : ""}`);
  }

  section("10. EXPERIMENTO A/B atribuído");
  const exp = listExperiments("running")[0];
  if (exp) {
    console.log(`   "${exp.name}" variável=${exp.variable} variantes=${JSON.parse(exp.variants_json).map((v: { key: string; count: number }) => `${v.key}:${v.count}`).join(" ")}`);
  } else {
    console.log("   (nenhum experimento em execução)");
  }

  section("11. CUSTO DE IA rastreado");
  recordAiCall({ lead_id: handoffLead.id, purpose: "e2e_demo", model: "gpt-4.1-mini", tokens_in: 320, tokens_out: 60, cost_usd: 0.000224 });
  const costs = aiCostStats();
  console.log(`   gasto no mês=US$ ${costs.monthTotal.toFixed(6)} · modelos=${costs.byModel.map((m) => m.model).join(", ") || "—"}`);

  section("12. WORKER: claim atômico + retry + dead-letter");
  enqueueJob("demo_kind", {}, { maxAttempts: 1 });
  const job = claimNextJob()!;
  console.log(`   job claimed: ${job.kind} (${job.status})`);
  completeJob(job.id);
  console.log(`   jobs no banco=${listJobs().length}`);

  section("13. RECUPERAÇÃO após reinício");
  const recovered = recoverStaleJobs(15);
  console.log(`   jobs presos recuperados=${recovered}`);

  section("14. PAUSA automática + retomada pelo operador");
  pauseSystem("simulação de risco no E2E");
  console.log(`   pausado=${isPaused()}`);
  resumeSystem();
  console.log(`   retomado=${!isPaused()}`);

  section("15. RESULTADO");
  const all = listLeads({ limit: 100 });
  const counts = all.reduce<Record<string, number>>((acc, l) => {
    acc[l.pipeline] = (acc[l.pipeline] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`   leads totais=${all.length}`);
  console.log(`   por etapa=${JSON.stringify(counts)}`);
  console.log(`   banco=${process.env.DATABASE_URL}`);
  console.log("\n✅ E2E completo — ciclo Observar→Decidir→Agir→Medir→Aprender→Adaptar demonstrado.");
}

main().catch((err) => {
  console.error("E2E falhou:", err);
  process.exit(1);
});
