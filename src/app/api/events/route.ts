import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const level = req.nextUrl.searchParams.get("level");
  const rows = level
    ? (getDb()
        .prepare("SELECT id, level, kind, lead_id, detail_json, created_at FROM events WHERE level = ? ORDER BY created_at DESC LIMIT 100")
        .all(level) as unknown as Array<Record<string, string>>)
    : (getDb()
        .prepare("SELECT id, level, kind, lead_id, detail_json, created_at FROM events ORDER BY created_at DESC LIMIT 100")
        .all() as unknown as Array<Record<string, string>>);
  return NextResponse.json({ events: rows });
}
