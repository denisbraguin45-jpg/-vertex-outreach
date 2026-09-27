// ─── Job durável de prospecção: roda no worker, fora do request HTTP ────────
// A UI enfileira "prospect_search"; este handler executa a coleta completa e
// persiste progresso/resultado no system_state para o painel consultar.

import { enqueueJob, getJob } from "@/db/jobs";
import { getSystemState, setSystemState, recordEvent } from "@/db";
import { runProspectingJob, type ProspectingCriteria, type ProspectingResult } from "./scraper";

const STATE_KEY = "prospecting_last_job";

export interface ProspectingJobState {
  jobId: string;
  status: "queued" | "running" | "done" | "failed";
  criteria: ProspectingCriteria | null;
  result: ProspectingResult | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export function enqueueProspecting(criteria: ProspectingCriteria): string {
  const jobId = enqueueJob("prospect_search", { ...criteria });
  const state: ProspectingJobState = {
    jobId,
    status: "queued",
    criteria,
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  setSystemState(STATE_KEY, JSON.stringify(state));
  return jobId;
}

export function lastProspectingState(): ProspectingJobState | null {
  const raw = getSystemState(STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProspectingJobState;
  } catch {
    return null;
  }
}

/** Chamado pelo worker quando um job kind="prospect_search" é claimed. */
export async function runProspectingJobHandler(jobId: string, payload: Record<string, unknown>): Promise<ProspectingResult> {
  const criteria: ProspectingCriteria = {
    nicho: String(payload.nicho ?? "outros"),
    location: String(payload.location ?? "São Paulo"),
    limit: Number(payload.limit ?? 100),
    usePlaces: payload.usePlaces === undefined ? undefined : Boolean(payload.usePlaces),
  };
  updateState(jobId, criteria, "running", null, null);
  try {
    const result = await runProspectingJob(criteria);
    updateState(jobId, criteria, "done", result, null);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateState(jobId, criteria, "failed", null, msg);
    recordEvent("error", "prospecting_failed", { error: msg, criteria });
    throw err;
  }
}

function updateState(
  jobId: string,
  criteria: ProspectingCriteria,
  status: ProspectingJobState["status"],
  result: ProspectingResult | null,
  error: string | null,
): void {
  const current = lastProspectingState();
  const state: ProspectingJobState = {
    jobId,
    status,
    criteria,
    result: result ?? current?.result ?? null,
    error: error ?? (status === "failed" ? null : current?.error ?? null),
    startedAt: current?.startedAt ?? new Date().toISOString(),
    finishedAt: status === "done" || status === "failed" ? new Date().toISOString() : null,
  };
  setSystemState(STATE_KEY, JSON.stringify(state));
}

export { getJob };
