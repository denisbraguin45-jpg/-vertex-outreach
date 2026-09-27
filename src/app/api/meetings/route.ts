import { NextRequest, NextResponse } from "next/server";
import { createMeeting, getMeeting, listMeetings, updateMeeting } from "@/db/comercial";
import { getProspect, appendProspectNote } from "@/db/prospects";
import { outreachLogFor } from "@/db/prospects";
import { suggestNextQuestion } from "@/features/intelligence/ai";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const prospectId = req.nextUrl.searchParams.get("prospectId") ?? undefined;
  return NextResponse.json({ meetings: listMeetings(prospectId) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { prospectId: string; scheduledAt?: string };
  const prospect = getProspect(body.prospectId);
  if (!prospect) return NextResponse.json({ error: "contato não encontrado" }, { status: 404 });

  const meeting = createMeeting({ prospectId: body.prospectId, scheduledAt: body.scheduledAt ?? null });

  // Briefing automático: contexto do contato + histórico + pergunta sugerida
  const history = outreachLogFor(body.prospectId)
    .slice(0, 10)
    .map((o) => `[${o.created_at.slice(0, 10)}] (${o.channel}) ${o.body.slice(0, 140)}`)
    .join("\n");
  const question = await suggestNextQuestion({
    companyName: prospect.company_name,
    niche: prospect.niche,
    painPoint: null,
    history,
  });
  const brief = [
    `Empresa: ${prospect.company_name} (${prospect.city ?? "?"}/${prospect.state ?? "?"})`,
    `Nicho: ${prospect.niche ?? "?"} · Site: ${prospect.website ?? "—"}`,
    `Status: ${prospect.status} · Último contato: ${prospect.last_contacted_at?.slice(0, 10) ?? "—"}`,
    prospect.notes ? `Observações:\n${prospect.notes}` : "Observações: —",
    history ? `\nHistórico de disparos:\n${history}` : "\nSem disparos registrados.",
    `\nPróxima pergunta sugerida: ${question}`,
  ].join("\n");
  updateMeeting(meeting.id, { brief });

  return NextResponse.json({ meeting: getMeeting(meeting.id) });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as {
    id: string;
    notes?: string;
    summary?: string;
    objections?: string;
    nextStep?: string;
    scheduledAt?: string | null;
  };
  if (!body.id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  const meeting = updateMeeting(body.id, {
    notes: body.notes,
    summary: body.summary,
    objections: body.objections,
    nextStep: body.nextStep,
    scheduledAt: body.scheduledAt === undefined ? undefined : body.scheduledAt,
  });
  if (!meeting) return NextResponse.json({ error: "reunião não encontrada" }, { status: 404 });
  if (body.nextStep) {
    appendProspectNote(meeting.prospect_id, `Próximo passo (reunião): ${body.nextStep}`);
  }
  return NextResponse.json({ meeting });
}
