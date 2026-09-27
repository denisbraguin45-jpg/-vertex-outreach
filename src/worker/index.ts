// ─── Vertex Outreach worker: durable jobs loop (autonomous cycle) ───────────
// Observar → Decidir → Agir → Medir → Aprender → Adaptar
// Runs alongside the Next.js panel: `pnpm up` (concurrently) or `pnpm worker`.

import "dotenv/config";
import { getDb, recordEvent } from "@/db";
import { claimNextJob, completeJob, failJob, recoverStaleJobs, enqueueJob } from "@/db/jobs";
import type { JobRecord } from "@/db";
import { isPaused, pauseReason, budgetAllowsAiCall, circuitBreakerAllowsAttempt, withinOperatingHours, resumeSystem } from "./safety";
import { runDiscoveryJob } from "@/features/discovery/job";
import { runProspectingJobHandler } from "@/features/prospecting/job";
import { runFirstContactJob } from "@/features/conversations/first-contact";
import { processInboundMessage, sweepWaitingReplies } from "@/features/conversations/handoff";
import { sendViaApi } from "@/integrations/instagram/webhook";
import { getLead, setNextAction } from "@/db/leads";
import { lastOutbound } from "@/db/messages";
import { composeReply, interpretInbound } from "@/features/conversations/engine";
import { verdict } from "@/db/experiments";
import { getEnv } from "@/config/env";

const POLL_MS = 5_000;

let running = false;
let ticks = 0;

async function main(): Promise<void> {
  console.log("[outreach] worker starting");
  getDb(); // migrate on boot
  const recovered = recoverStaleJobs();
  if (recovered > 0) console.log(`[outreach] recovered ${recovered} stale jobs after restart`);
  recordEvent("info", "worker_boot", { recovered });

  // seed recurring maintenance jobs
  seedRecurring();

  setInterval(tick, POLL_MS);
  console.log("[outreach] worker loop active (5s poll)");
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  ticks++;
  try {
    // Global pause check (operator or circuit breaker).
    if (isPaused()) {
      if (ticks % 60 === 0) console.log(`[outreach] paused: ${pauseReason()}`);
      return;
    }

    // Operating hours gate for outbound actions (jobs like sweeps still run).
    const inHours = withinOperatingHours();

    const job = claimNextJob();
    if (!job) {
      if (ticks % 120 === 0) console.log("[outreach] queue idle");
      return;
    }

    await executeJob(job, inHours);
  } catch (err) {
    console.error("[outreach] tick error:", err);
  } finally {
    running = false;
  }
}

async function executeJob(job: JobRecord, inHours: boolean): Promise<void> {
  const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  try {
    switch (job.kind) {
      case "discovery": {
        const funnel = (payload.funnel as string) ?? "clients";
        const res = await runDiscoveryJob(funnel === "affiliates" ? "affiliates" : "clients");
        console.log(`[outreach] discovery(${funnel}): found=${res.found} new=${res.created} dup=${res.duplicates} queued=${res.contactJobsQueued}`);
        completeJob(job.id);
        // re-enqueue next discovery cycle in 6h (autonomous observation loop)
        enqueueJob("discovery", { funnel }, { runAt: new Date(Date.now() + 6 * 3600_000) });
        return;
      }

      case "first_contact": {
        if (!inHours) {
          // postpone to next operating window — never send outside hours
          enqueueJob("first_contact", payload, { runAt: nextWindow() });
          completeJob(job.id);
          return;
        }
        if (!budgetAllowsAiCall() || !circuitBreakerAllowsAttempt()) {
          enqueueJob("first_contact", payload, { runAt: new Date(Date.now() + 1800_000) });
          completeJob(job.id);
          return;
        }
        const res = await runFirstContactJob(payload.leadId as string);
        console.log(`[outreach] first_contact ${payload.leadId}: sent=${res.sent} (${res.reason})`);
        completeJob(job.id);
        return;
      }

      case "follow_up": {
        if (!inHours || !budgetAllowsAiCall()) {
          enqueueJob("follow_up", payload, { runAt: new Date(Date.now() + 3600_000) });
          completeJob(job.id);
          return;
        }
        await runFollowUp(payload.leadId as string);
        completeJob(job.id);
        return;
      }

      case "prospect_search": {
        // Prospecção multicanal: rodar mesmo fora do horário/pausa de IA —
        // é coleta de dados públicos, não envio de mensagem.
        const res = await runProspectingJobHandler(job.id, payload);
        console.log(`[outreach] prospect_search ${res.nicho}/${res.location}: found=${res.found} new=${res.newProspects} dup=${res.duplicates}`);
        completeJob(job.id);
        return;
      }

      case "sweep_waiting": {
        const flagged = sweepWaitingReplies();
        console.log(`[outreach] sweep: ${flagged} leads flagged (48h without reply)`);
        completeJob(job.id);
        enqueueJob("sweep_waiting", {}, { runAt: new Date(Date.now() + 3600_000) });
        return;
      }

      case "check_experiments": {
        const { listExperiments } = await import("@/db/experiments");
        for (const exp of listExperiments("running")) {
          const v = verdict(exp.id);
          if (v?.winner) {
            console.log(`[outreach] experiment "${exp.name}": winner=${v.winner} — promote weights gradually`);
            recordEvent("info", "experiment_winner", { experiment: exp.name, winner: v.winner });
          }
        }
        completeJob(job.id);
        enqueueJob("check_experiments", {}, { runAt: new Date(Date.now() + 12 * 3600_000) });
        return;
      }

      default:
        console.warn(`[outreach] unknown job kind: ${job.kind}`);
        failJob(job.id, `unknown kind ${job.kind}`);
        return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[outreach] job ${job.kind} (${job.id}) failed: ${msg}`);
    failJob(job.id, msg);
  }
}

// ─── Follow-up job: nudge leads without reply, once, politely ───────────────

async function runFollowUp(leadId: string): Promise<void> {
  const lead = getLead(leadId);
  if (!lead) return;
  if (lead.channel === "do_not_contact") return;
  const last = lastOutbound(leadId);
  if (!last) return;
  // Only one follow-up per lead: second outbound already exists → skip.
  const { leadHistory } = await import("@/db/messages");
  const outbounds = leadHistory(leadId).filter((m) => m.direction === "outbound");
  if (outbounds.length >= 2) {
    setNextAction(leadId, null);
    return;
  }
  const interpretation = await interpretInbound(lead, "(sem resposta após 3 dias)");
  const reply = await composeReply(lead, { ...interpretation, action: "schedule_followup" });
  if (reply) {
    const send = await sendViaApi(lead.instagram_user_id ?? "", reply);
    if (send.ok) {
      const { appendMessage } = await import("@/db/messages");
      appendMessage({ lead_id: leadId, direction: "outbound", channel: "api", body: reply, ai_action: "schedule_followup" });
      setNextAction(leadId, null);
    }
  }
}

function nextWindow(): Date {
  const env = getEnv();
  const [eh] = env.OPERATING_HOURS.end.split(":").map(Number);
  const next = new Date();
  next.setHours(eh, 30, 0, 0); // shortly after window closes → tomorrow morning tick
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  return next;
}

function seedRecurring(): void {
  const d = getDb();
  const has = (kind: string): boolean =>
    (d.prepare("SELECT COUNT(*) as n FROM jobs WHERE kind = ? AND status IN ('queued','running')").get(kind) as { n: number }).n > 0;
  if (!has("discovery")) {
    enqueueJob("discovery", { funnel: "clients" });
    enqueueJob("discovery", { funnel: "affiliates" });
  }
  if (!has("sweep_waiting")) enqueueJob("sweep_waiting", {}, { runAt: new Date(Date.now() + 3600_000) });
  if (!has("check_experiments")) enqueueJob("check_experiments", {}, { runAt: new Date(Date.now() + 12 * 3600_000) });
}

main().catch((err) => {
  console.error("[outreach] fatal:", err);
  process.exit(1);
});
