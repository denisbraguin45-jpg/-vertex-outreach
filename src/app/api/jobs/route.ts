import { NextRequest, NextResponse } from "next/server";
import { listJobs } from "@/db/jobs";
import type { JobRecord } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") as JobRecord["status"] | null;
  return NextResponse.json({ jobs: listJobs(status ?? undefined, 100) });
}
