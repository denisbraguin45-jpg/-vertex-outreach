import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { isPaused, pauseReason } from "@/worker/safety";
import { listJobs } from "@/db/jobs";
import { funnelCounters } from "@/db/leads";
import { aiCostStats } from "@/db/messages";
import { getEnv } from "@/config/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const d = getDb();
  const events = d
    .prepare("SELECT id, level, kind, created_at FROM events ORDER BY created_at DESC LIMIT 20")
    .all() as Array<{ id: string; level: string; kind: string; created_at: string }>;
  const queue = (
    d.prepare("SELECT COUNT(*) as n FROM jobs WHERE status IN ('queued','running')").get() as { n: number }
  ).n;

  return NextResponse.json({
    paused: isPaused(),
    reason: pauseReason(),
    dryRun: getEnv().OUTREACH_DRY_RUN,
    queue,
    leads: funnelCounters(),
    aiCost: aiCostStats(),
    recentEvents: events,
  });
}
