// ─── Safety: global pause, circuit breaker, budget guard, operating hours ───
// The system pauses itself on risk and calls the operator. All state lives in
// SQLite so pause survives restarts.

import { getEnv } from "@/config/env";
import { getSystemState, setSystemState, recordEvent } from "@/db/index";
import { monthlyAiSpend } from "@/db/messages";

const KEY_PAUSED = "paused";
const KEY_PAUSE_REASON = "pause_reason";
const KEY_CB_FAILURES = "cb_failures";
const KEY_CB_OPENED_AT = "cb_opened_at";

const CB_THRESHOLD = 5; // consecutive failures open the circuit
const CB_COOLDOWN_MIN = 30; // auto half-open attempt after this

// ─── Global pause ────────────────────────────────────────────────────────────

export function pauseSystem(reason: string): void {
  if (isPaused()) return;
  setSystemState(KEY_PAUSED, "true");
  setSystemState(KEY_PAUSE_REASON, reason);
  recordEvent("warn", "system_paused", { reason });
  console.warn(`[outreach] SYSTEM PAUSED: ${reason}`);
}

export function resumeSystem(): void {
  setSystemState(KEY_PAUSED, "false");
  setSystemState(KEY_PAUSE_REASON, "");
  resetCircuitBreaker();
  recordEvent("info", "system_resumed", {});
}

export function isPaused(): boolean {
  return getSystemState(KEY_PAUSED) === "true";
}

export function pauseReason(): string {
  return getSystemState(KEY_PAUSE_REASON) ?? "";
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────

export function reportFailure(context: string, error: string): void {
  const fails = Number(getSystemState(KEY_CB_FAILURES) ?? "0") + 1;
  setSystemState(KEY_CB_FAILURES, String(fails));
  if (fails >= CB_THRESHOLD) {
    setSystemState(KEY_CB_OPENED_AT, new Date().toISOString());
    pauseSystem(`circuit breaker: ${fails} falhas consecutivas (última: ${context}: ${error.slice(0, 120)})`);
  }
}

export function reportSuccess(): void {
  setSystemState(KEY_CB_FAILURES, "0");
}

export function circuitBreakerAllowsAttempt(): boolean {
  const openedAt = getSystemState(KEY_CB_OPENED_AT);
  if (!openedAt) return true;
  const elapsedMin = (Date.now() - new Date(openedAt).getTime()) / 60_000;
  return elapsedMin >= CB_COOLDOWN_MIN; // half-open: allow a probe attempt
}

function resetCircuitBreaker(): void {
  setSystemState(KEY_CB_FAILURES, "0");
  setSystemState(KEY_CB_OPENED_AT, "");
}

// ─── Budget guard ────────────────────────────────────────────────────────────

export function budgetAllowsAiCall(): boolean {
  const spent = monthlyAiSpend();
  const limit = getEnv().OPENAI_MONTHLY_BUDGET_USD;
  if (spent >= limit) {
    pauseSystem(`orçamento OpenAI esgotado: US$ ${spent.toFixed(2)} de US$ ${limit.toFixed(2)}`);
    return false;
  }
  return true;
}

// ─── Operating hours (rhythm for account health) ─────────────────────────────

export function withinOperatingHours(now = new Date()): boolean {
  const { OPERATING_HOURS, OPERATING_TIMEZONE } = getEnv();
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: OPERATING_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const [h, m] = local.split(":").map(Number);
  const [sh, sm] = OPERATING_HOURS.start.split(":").map(Number);
  const [eh, em] = OPERATING_HOURS.end.split(":").map(Number);
  const nowMin = h * 60 + m;
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  return nowMin >= startMin && nowMin < endMin;
}
