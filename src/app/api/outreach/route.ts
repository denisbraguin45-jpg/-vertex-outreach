import { NextRequest, NextResponse } from "next/server";
import {
  recordOutreach,
  recentOutreach,
  outreachCounters,
  outreachLogFor,
  getProspect,
  appendProspectNote,
  type OutreachLogRecord,
} from "@/db/prospects";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const prospectId = req.nextUrl.searchParams.get("prospectId");
  if (prospectId) {
    return NextResponse.json({ history: outreachLogFor(prospectId) });
  }
  return NextResponse.json({ recent: recentOutreach(50), counters: outreachCounters() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    prospectId: string;
    channel: OutreachLogRecord["channel"];
    templateId?: string | null;
    subject?: string | null;
    body: string;
    failed?: boolean;
    detail?: string | null;
    note?: string;
  };
  if (!body.prospectId || !body.channel || !body.body) {
    return NextResponse.json({ error: "prospectId, channel e body são obrigatórios" }, { status: 400 });
  }
  const prospect = getProspect(body.prospectId);
  if (!prospect) return NextResponse.json({ error: "contato não encontrado" }, { status: 404 });
  if (prospect.status === "opt_out") {
    return NextResponse.json({ error: "contato em opt-out — disparo bloqueado" }, { status: 422 });
  }

  const entry = recordOutreach({
    prospectId: body.prospectId,
    channel: body.channel,
    templateId: body.templateId ?? null,
    subject: body.subject ?? null,
    body: body.body,
    status: body.failed ? "falha" : "registrado",
    detail: body.detail ?? null,
  });
  if (body.note) appendProspectNote(body.prospectId, body.note);
  return NextResponse.json({ entry, prospect: getProspect(body.prospectId) });
}
