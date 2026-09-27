// ─── Durable jobs on SQLite (no Redis needed for the MVP) ───────────────────
// Claim pattern: UPDATE ... WHERE status='queued' guarantees a single worker
// picks each job even after restart or with multiple processes (WAL + timeout).

import { getDb, nowISO, newId } from "./index";
import { asRow, asRows } from "./rows";
import type { JobRecord } from "./index";

export function enqueueJob(
  kind: string,
  payload: Record<string, unknown> = {},
  opts: { runAt?: Date; maxAttempts?: number } = {},
): string {
  const id = newId();
  getDb()
    .prepare(
      "INSERT INTO jobs (id, kind, payload_json, status, run_at, max_attempts, created_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)",
    )
    .run(id, kind, JSON.stringify(payload), (opts.runAt ?? new Date()).toISOString(), opts.maxAttempts ?? 3, nowISO());
  return id;
}

/** Atomically claim the next due job. Returns null when the queue is empty. */
export function claimNextJob(): JobRecord | null {
  const d = getDb();
  const candidate = d
    .prepare(
      `SELECT id FROM jobs
       WHERE status = 'queued' AND run_at <= ?
       ORDER BY run_at ASC LIMIT 1`,
    )
    .get(nowISO()) as { id: string } | undefined;
  if (!candidate) return null;

  const claimed = d
    .prepare(
      `UPDATE jobs SET status = 'running', started_at = ?, attempts = attempts + 1
       WHERE id = ? AND status = 'queued'`,
    )
    .run(nowISO(), candidate.id);
  if (claimed.changes !== 1) return null;

  return asRow<JobRecord>(d.prepare("SELECT * FROM jobs WHERE id = ?").get(candidate.id));
}

export function completeJob(id: string): void {
  getDb()
    .prepare("UPDATE jobs SET status = 'done', finished_at = ?, last_error = NULL WHERE id = ?")
    .run(nowISO(), id);
}

export function failJob(id: string, error: string): void {
  const job = getJob(id);
  if (!job) return;
  if (job.attempts >= job.max_attempts) {
    // dead-letter: stays visible in the panel for the operator
    getDb()
      .prepare("UPDATE jobs SET status = 'dead', last_error = ?, finished_at = ? WHERE id = ?")
      .run(error.slice(0, 500), nowISO(), id);
  } else {
    // exponential-ish backoff: 30s * 2^attempts
    const backoffMs = 30_000 * Math.pow(2, job.attempts);
    getDb()
      .prepare("UPDATE jobs SET status = 'queued', last_error = ?, run_at = ? WHERE id = ?")
      .run(error.slice(0, 500), new Date(Date.now() + backoffMs).toISOString(), id);
  }
}

export function getJob(id: string): JobRecord | null {
  return asRow<JobRecord>(getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id));
}

export function listJobs(status?: JobRecord["status"], limit = 50): JobRecord[] {
  if (status) {
    return asRows<JobRecord>(
      getDb().prepare("SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, limit),
    );
  }
  return asRows<JobRecord>(
    getDb().prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit),
  );
}

/** Requeue jobs stuck in 'running' after a crash/restart (staleness window). */
export function recoverStaleJobs(maxMinutesStale = 15): number {
  const cutoff = new Date(Date.now() - maxMinutesStale * 60_000).toISOString();
  const res = getDb()
    .prepare(
      `UPDATE jobs SET status = 'queued', last_error = 'recovered after restart'
       WHERE status = 'running' AND started_at < ?`,
    )
    .run(cutoff);
  return Number(res.changes);
}

export function pauseQueue(): void {
  getDb().prepare("UPDATE jobs SET status = 'paused' WHERE status = 'queued'").run();
}

export function resumeQueue(): void {
  getDb().prepare("UPDATE jobs SET status = 'queued' WHERE status = 'paused'").run();
}
