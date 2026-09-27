// ─── First contact job: browser funnel, rhythm-checked, experiment-aware ────

import { getLead, transitionLead, appendNote, setNextAction } from "@/db/leads";
import type { LeadRecord } from "@/db";
import { appendMessage } from "@/db/messages";
import { enqueueJob } from "@/db/jobs";
import { sendFirstDm } from "@/integrations/browser/cdp";
import { BrowserUnavailableError } from "@/integrations/browser/cdp";
import { pauseSystem, reportFailure, reportSuccess } from "@/worker/safety";
import { canSendBrowserDmNow, nextSendSlotISO } from "@/worker/rhythm";
import { composeOpening } from "./engine";
import { listExperiments, assignVariant, createExperiment } from "@/db/experiments";
import { recordEvent } from "@/db/index";
import { getEnv } from "@/config/env";

/** Ensures the opening experiment exists (idempotent). */
function ensureOpeningExperiment(): string | null {
  const running = listExperiments("running").find((e) => e.variable === "opening_variant");
  if (running) return running.id;
  try {
    return createExperiment({
      name: "Abertura: pergunta leve vs. observação",
      hypothesis: "Abrir com observação específica do perfil converte mais que permissão genérica",
      variable: "opening_variant",
      variants: [
        { key: "permission", weight: 0.45 },
        { key: "observation", weight: 0.45 },
        { key: "exploration", weight: 0.10 },
      ],
      minSamplePerVariant: 30,
    }).id;
  } catch {
    return null;
  }
}

export async function runFirstContactJob(leadId: string): Promise<{ sent: boolean; reason: string }> {
  const lead = getLead(leadId);
  if (!lead) return { sent: false, reason: "lead not found" };
  if (lead.channel === "do_not_contact" || lead.channel === "blocked") {
    return { sent: false, reason: "lead is DNC/blocked" };
  }
  if (lead.pipeline === "discovered") {
    transitionLead(leadId, "qualified", null, "promotion before first contact");
  }
  const fresh = getLead(leadId)!;
  const eligible: LeadRecord["pipeline"][] = ["qualified", "contacted"];
  if (!eligible.includes(fresh.pipeline)) {
    return { sent: false, reason: `pipeline ${fresh.pipeline} not eligible for first contact` };
  }

  // Rhythm gate (daily cap + warmup).
  const rhythm = canSendBrowserDmNow();
  if (!rhythm.ok) {
    setNextAction(leadId, nextSendSlotISO());
    enqueueJob("first_contact", { leadId }, { runAt: new Date(Date.now() + 3600_000) });
    return { sent: false, reason: `rhythm: ${rhythm.reason}` };
  }

  // Channel ownership: first contact must go via browser.
  const expId = ensureOpeningExperiment();
  const variant = expId ? assignVariant(expId, leadId) : "permission";

  const opening = await composeOpening(fresh, variant);

  // Persist the composed message with variant BEFORE sending (audit trail).
  appendMessage({
    lead_id: leadId,
    direction: "outbound",
    channel: "browser",
    body: opening,
    variant,
    ai_action: "reply",
  });

  // Dry-run: no browser needed — log the composed message and advance state.
  if (getEnv().OUTREACH_DRY_RUN) {
    const variantNote = `(dry-run, variante ${variant})`;
    transitionLead(leadId, "contacted", "browser_contact_sent", `first DM composed ${variantNote}`);
    transitionLead(leadId, null, "waiting_inbound_reply", "awaiting lead reply (dry-run)");
    setNextAction(leadId, new Date(Date.now() + 2 * 86_400_000).toISOString());
    appendNote(leadId, `Primeira DM composta ${variantNote}: "${opening.slice(0, 80)}…"`);
    recordEvent("info", "first_contact_dry_run", { variant }, leadId);
    return { sent: true, reason: `dry-run: message composed (variant ${variant})` };
  }

  try {
    const result = await sendFirstDm(fresh.instagram_handle, opening, { dryRun: false });

    if (!result.ok) {
      reportFailure("browser_send", result.error ?? "unknown");
      appendNote(leadId, `browser send failed: ${result.error?.slice(0, 200)}`);
      if (result.evidence || /session lost/.test(result.error ?? "")) {
        transitionLead(leadId, null, "human_review_required", "browser failure with evidence");
      } else {
        setNextAction(leadId, nextSendSlotISO());
        enqueueJob("first_contact", { leadId }, { runAt: new Date(Date.now() + 1800_000) });
      }
      if (result.evidence) {
        recordEvent("error", "browser_send_failed", { error: result.error, evidence: result.evidence }, leadId);
      }
      return { sent: false, reason: result.error ?? "browser send failed" };
    }

    reportSuccess();
    transitionLead(leadId, "contacted", "browser_contact_sent", `first DM sent (variant ${variant}${result.dryRun ? ", dry-run" : ""})`);
    transitionLead(leadId, null, "waiting_inbound_reply", "awaiting lead reply");
    setNextAction(leadId, new Date(Date.now() + 2 * 86_400_000).toISOString()); // 48h window check
    appendNote(leadId, `Primeira DM ${result.dryRun ? "(dry-run) " : ""}enviada · variante ${variant}`);
    recordEvent("info", "first_contact_sent", { variant, dryRun: result.dryRun }, leadId);
    return { sent: true, reason: result.message ?? "sent" };
  } catch (err) {
    if (err instanceof BrowserUnavailableError) {
      recordEvent("error", "browser_unavailable", { error: err.message }, leadId);
      pauseSystem(`navegador indisponível: ${err.message.slice(0, 120)} — fila pausada, operador precisa subir o Chrome`);
      return { sent: false, reason: "browser unavailable — system paused" };
    }
    reportFailure("browser_send_exception", err instanceof Error ? err.message : String(err));
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
