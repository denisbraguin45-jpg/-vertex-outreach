import { NextRequest, NextResponse } from "next/server";
import {
  addResearch, listResearch, deleteResearch, listBriefs, deleteBrief,
  addCalendarItem, listCalendar, setCalendarStatus, marketingCounters,
  type ResearchKind,
} from "@/db/marketing";
import { generateAsset } from "@/features/marketing/generate";

export const dynamic = "force-dynamic";

const KINDS: ResearchKind[] = ["dor", "objecao", "oferta_concorrente", "angulo", "hipotese"];

export async function GET(req: NextRequest) {
  const market = req.nextUrl.searchParams.get("market") ?? undefined;
  return NextResponse.json({
    research: listResearch(market),
    briefs: listBriefs(),
    calendar: listCalendar(),
    counters: marketingCounters(),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Record<string, unknown>;
  const action = String(body.action ?? "");

  switch (action) {
    case "add-research": {
      const kind = body.kind as ResearchKind;
      if (!body.market || !KINDS.includes(kind) || !body.content) {
        return NextResponse.json({ error: "market, kind e content são obrigatórios" }, { status: 400 });
      }
      const entry = addResearch({
        market: String(body.market),
        kind,
        content: String(body.content),
        source: body.source ? String(body.source) : null,
      });
      return NextResponse.json({ entry });
    }

    case "generate": {
      const kind = body.kind as Parameters<typeof generateAsset>[0]["kind"];
      if (!body.market || !kind) {
        return NextResponse.json({ error: "market e kind são obrigatórios" }, { status: 400 });
      }
      const result = await generateAsset({
        market: String(body.market),
        kind,
        title: body.title ? String(body.title) : undefined,
        offer: body.offer ? String(body.offer) : undefined,
        proof: body.proof ? String(body.proof) : undefined,
      });
      return NextResponse.json({ result });
    }

    case "add-calendar": {
      if (!body.title || !body.channel) {
        return NextResponse.json({ error: "title e channel são obrigatórios" }, { status: 400 });
      }
      const item = addCalendarItem({
        title: String(body.title),
        channel: String(body.channel),
        plannedDate: body.plannedDate ? String(body.plannedDate) : null,
        briefId: body.briefId ? String(body.briefId) : null,
      });
      return NextResponse.json({ item });
    }

    case "set-calendar-status": {
      if (!body.id || !body.status) return NextResponse.json({ error: "id e status obrigatórios" }, { status: 400 });
      setCalendarStatus(String(body.id), body.status as "planejado" | "producao" | "publicado");
      return NextResponse.json({ ok: true });
    }

    case "delete-research": {
      deleteResearch(String(body.id));
      return NextResponse.json({ ok: true });
    }

    case "delete-brief": {
      deleteBrief(String(body.id));
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `ação desconhecida: ${action}` }, { status: 400 });
  }
}
