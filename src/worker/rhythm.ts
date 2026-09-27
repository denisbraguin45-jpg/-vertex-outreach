// ─── Human rhythm: daily cap, warmup ramp, randomized interval ──────────────
// For account health — same discipline as a real SDR. Not for evading detection.

import { getEnv } from "@/config/env";
import { getDb, getSystemState, setSystemState } from "@/db";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Warmup: 5/day in week 1, +5 per week, capped by MAX_DMS_PER_DAY. */
export function dailyCap(): number {
  const cap = getEnv().MAX_DMS_PER_DAY;
  const firstDay = getSystemState("warmup_start");
  if (!firstDay) {
    setSystemState("warmup_start", todayKey());
    return Math.min(5, cap);
  }
  const days = Math.floor((Date.now() - new Date(firstDay).getTime()) / 86_400_000);
  const warmup = Math.min(5 + Math.floor(days / 7) * 5, cap);
  return warmup;
}

export function dmsSentToday(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as n FROM messages
       WHERE direction = 'outbound' AND channel = 'browser' AND created_at >= ?`,
    )
    .get(`${todayKey()}T00:00:00.000Z`) as { n: number };
  return row.n;
}

export function canSendBrowserDmNow(): { ok: boolean; reason: string } {
  const sent = dmsSentToday();
  const cap = dailyCap();
  if (sent >= cap) return { ok: false, reason: `daily cap reached (${sent}/${cap})` };
  return { ok: true, reason: `${sent}/${cap} today` };
}

/** Randomized human-like interval in ms between MIN and MAX seconds. */
export function nextIntervalMs(): number {
  const { MIN_SECONDS_BETWEEN_DMS, MAX_SECONDS_BETWEEN_DMS } = getEnv();
  const min = Math.min(MIN_SECONDS_BETWEEN_DMS, MAX_SECONDS_BETWEEN_DMS);
  const max = Math.max(MIN_SECONDS_BETWEEN_DMS, MAX_SECONDS_BETWEEN_DMS);
  return (min + Math.random() * (max - min)) * 1000;
}

/** When should the next browser DM job run? */
export function nextSendSlotISO(): string {
  return new Date(Date.now() + nextIntervalMs()).toISOString();
}
