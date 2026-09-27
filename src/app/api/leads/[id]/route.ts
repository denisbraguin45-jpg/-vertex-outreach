import { NextRequest, NextResponse } from "next/server";
import { getLead, transitionLead, markDoNotContact, setNextAction } from "@/db/leads";
import { leadHistory } from "@/db/messages";
import type { LeadRecord } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const lead = getLead(id);
  if (!lead) return NextResponse.json({ error: "lead não encontrado" }, { status: 404 });
  return NextResponse.json({ lead, messages: leadHistory(id) });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    pipeline?: string;
    channel?: string;
    doNotContact?: boolean;
    nextActionAt?: string | null;
    reason?: string;
  };
  if (body.doNotContact) {
    markDoNotContact(id, body.reason ?? "manual do operador");
    return NextResponse.json({ ok: true });
  }
  const lead = transitionLead(
    id,
    (body.pipeline as LeadRecord["pipeline"]) ?? null,
    (body.channel as LeadRecord["channel"]) ?? null,
    body.reason ?? "ajuste manual do operador",
  );
  if (!lead) return NextResponse.json({ error: "transição inválida (veja o log de eventos)" }, { status: 422 });
  if (body.nextActionAt !== undefined) setNextAction(id, body.nextActionAt);
  return NextResponse.json({ lead });
}
