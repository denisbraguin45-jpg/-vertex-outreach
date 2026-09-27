import { NextRequest, NextResponse } from "next/server";
import { ingestInbound, listInbox, setInboxStatus, getInboxItem, type InboxStatus } from "@/db/comercial";
import { classifyReply } from "@/features/intelligence/ai";
import { getProspect } from "@/db/prospects";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") as InboxStatus | null;
  return NextResponse.json({ items: listInbox(status ?? undefined) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { prospectId: string; channel?: string; body: string };
  if (!body.prospectId || !body.body) {
    return NextResponse.json({ error: "prospectId e body são obrigatórios" }, { status: 400 });
  }
  const prospect = getProspect(body.prospectId);
  if (!prospect) return NextResponse.json({ error: "contato não encontrado" }, { status: 404 });

  const item = ingestInbound({ prospectId: body.prospectId, channel: body.channel ?? "manual", body: body.body });
  // classifica imediatamente (IA se configurada; senão heurística determinística)
  const classification = await classifyReply(body.body, prospect.company_name);
  const { updateInboxClassification } = await import("@/db/comercial");
  updateInboxClassification(item.id, classification.intent, classification.summary, classification.suggestsMeeting);

  // opt-out detectado → registra no prospect (opt-out global)
  if (classification.intent === "opt_out") {
    const { setProspectStatus } = await import("@/db/prospects");
    setProspectStatus(body.prospectId, "opt_out");
  }

  return NextResponse.json({ item: getInboxItem(item.id), classification });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as { id: string; status: InboxStatus };
  if (!body.id || !body.status) return NextResponse.json({ error: "id e status obrigatórios" }, { status: 400 });
  setInboxStatus(body.id, body.status);
  return NextResponse.json({ item: getInboxItem(body.id) });
}
