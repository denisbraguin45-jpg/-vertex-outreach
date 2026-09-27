import { NextRequest, NextResponse } from "next/server";
import { createDeal, listDeals, setDealStage, type DealStage } from "@/db/comercial";
import { getProspect } from "@/db/prospects";

export const dynamic = "force-dynamic";

const STAGES: DealStage[] = ["proposta", "negociacao", "ganho", "perdido"];

export async function GET(req: NextRequest) {
  const prospectId = req.nextUrl.searchParams.get("prospectId") ?? undefined;
  const stage = (req.nextUrl.searchParams.get("stage") as DealStage | null) ?? undefined;
  return NextResponse.json({ deals: listDeals({ prospectId, stage }) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { prospectId: string; title?: string; valueCents?: number; notes?: string };
  const prospect = getProspect(body.prospectId);
  if (!prospect) return NextResponse.json({ error: "contato não encontrado" }, { status: 404 });
  const deal = createDeal({
    prospectId: body.prospectId,
    title: body.title?.trim() || `Proposta · ${prospect.company_name}`,
    valueCents: body.valueCents,
    notes: body.notes ?? null,
  });
  return NextResponse.json({ deal });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as { id: string; stage: DealStage; notes?: string };
  if (!body.id || !STAGES.includes(body.stage)) {
    return NextResponse.json({ error: "id e stage válidos são obrigatórios" }, { status: 400 });
  }
  const deal = setDealStage(body.id, body.stage, body.notes);
  if (!deal) return NextResponse.json({ error: "deal não encontrado" }, { status: 404 });
  return NextResponse.json({ deal });
}
