import { NextRequest, NextResponse } from "next/server";
import {
  listProspects,
  countProspects,
  deleteProspects,
  prospectCounters,
  listNiches,
  type ProspectStatus,
} from "@/db/prospects";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filters = {
    search: sp.get("search") || undefined,
    niche: sp.get("niche") || undefined,
    city: sp.get("city") || undefined,
    state: sp.get("state") || undefined,
    hasWhatsapp: sp.get("hasWhatsapp") === "1",
    hasEmail: sp.get("hasEmail") === "1",
    hasInstagram: sp.get("hasInstagram") === "1",
    hasSite: sp.get("hasSite") === "1",
    noSite: sp.get("noSite") === "1",
    status: (sp.get("status") as ProspectStatus) || undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : 200,
    offset: sp.get("offset") ? Number(sp.get("offset")) : 0,
  };
  const [prospects, total] = [listProspects(filters), countProspects(filters)];
  return NextResponse.json({ prospects, total, counters: prospectCounters(), niches: listNiches() });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json()) as { ids?: string[]; all?: boolean; filters?: Record<string, unknown> };
  if (body.all) {
    // Excluir em massa conforme filtros atuais (mesma lógica da listagem)
    const sp = req.nextUrl.searchParams;
    const all = listProspects({
      search: sp.get("search") || undefined,
      niche: sp.get("niche") || undefined,
      status: (sp.get("status") as ProspectStatus) || undefined,
      limit: 1_000_000,
    });
    const removed = deleteProspects(all.map((p) => p.id));
    return NextResponse.json({ removed });
  }
  const removed = deleteProspects(body.ids ?? []);
  return NextResponse.json({ removed });
}
