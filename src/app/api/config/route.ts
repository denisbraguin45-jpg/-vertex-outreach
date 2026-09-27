import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/config/env";
import { getBusiness, verifiedClaims, unverifiedClaims } from "@/config/business";
import { setSystemState, recordEvent } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = getEnv();
  let browserStatus = "não verificado";
  try {
    // Cheap CDP version probe (1s timeout)
    const res = await fetch(`${env.CHROME_CDP_URL}/json/version`, { signal: AbortSignal.timeout(1500) });
    browserStatus = res.ok ? "conectado" : `HTTP ${res.status}`;
  } catch {
    browserStatus = "indisponível (Chrome com --remote-debugging-port precisa estar rodando)";
  }

  let business: ReturnType<typeof getBusiness> | null = null;
  try {
    business = getBusiness();
  } catch {
    business = null;
  }

  return NextResponse.json({
    dryRun: env.OUTREACH_DRY_RUN,
    limits: {
      maxDmsPerDay: env.MAX_DMS_PER_DAY,
      minSeconds: env.MIN_SECONDS_BETWEEN_DMS,
      maxSeconds: env.MAX_SECONDS_BETWEEN_DMS,
      hours: `${env.OPERATING_HOURS.start}–${env.OPERATING_HOURS.end}`,
      timezone: env.OPERATING_TIMEZONE,
      budgetUsd: env.OPENAI_MONTHLY_BUDGET_USD,
    },
    integrations: {
      openai: Boolean(env.OPENAI_API_KEY),
      instagramApi: Boolean(env.INSTAGRAM_PAGE_ACCESS_TOKEN && env.INSTAGRAM_BUSINESS_ACCOUNT_ID),
      browser: browserStatus,
    },
    claims: {
      verified: business ? verifiedClaims() : [],
      unverified: business ? unverifiedClaims() : [],
    },
  });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as { dryRun?: boolean };
  if (typeof body.dryRun === "boolean") {
    setSystemState("dry_run_override", body.dryRun ? "true" : "false");
    recordEvent("info", "dry_run_toggled", { dryRun: body.dryRun });
  }
  return NextResponse.json({ ok: true, dryRun: body.dryRun });
}
