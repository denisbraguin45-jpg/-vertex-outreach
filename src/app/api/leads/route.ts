import { NextRequest, NextResponse } from "next/server";
import { listLeads } from "@/db/leads";
import type { ChannelState, FunnelKind, Pipeline } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const leads = listLeads({
    funnel: (sp.get("funnel") as FunnelKind) || undefined,
    pipeline: (sp.get("pipeline") as Pipeline) || undefined,
    channel: (sp.get("channel") as ChannelState) || undefined,
    search: sp.get("search") || undefined,
    minScore: sp.get("minScore") ? Number(sp.get("minScore")) : undefined,
    dueOnly: sp.get("dueOnly") === "1",
    limit: sp.get("limit") ? Number(sp.get("limit")) : 100,
  });
  return NextResponse.json({ leads });
}
