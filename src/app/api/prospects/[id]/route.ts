import { NextRequest, NextResponse } from "next/server";
import {
  getProspect,
  setProspectStatus,
  appendProspectNote,
  outreachLogFor,
  PROSPECT_STATUSES,
  type ProspectStatus,
} from "@/db/prospects";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const prospect = getProspect(id);
  if (!prospect) return NextResponse.json({ error: "contato não encontrado" }, { status: 404 });
  return NextResponse.json({ prospect, history: outreachLogFor(id) });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { status?: string; note?: string };
  if (body.status) {
    if (!PROSPECT_STATUSES.includes(body.status as ProspectStatus)) {
      return NextResponse.json({ error: "status inválido" }, { status: 400 });
    }
    const updated = setProspectStatus(id, body.status as ProspectStatus);
    if (!updated) return NextResponse.json({ error: "transição de status inválida" }, { status: 422 });
  }
  if (body.note) appendProspectNote(id, body.note);
  const prospect = getProspect(id);
  if (!prospect) return NextResponse.json({ error: "contato não encontrado" }, { status: 404 });
  return NextResponse.json({ prospect });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const removed = await import("@/db/prospects").then((m) => m.deleteProspects([id]));
  return NextResponse.json({ removed });
}
