import { NextRequest, NextResponse } from "next/server";
import {
  listTemplates,
  saveTemplate,
  deleteTemplate,
  type MessageTemplateRecord,
} from "@/db/prospects";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ templates: listTemplates() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    id?: string;
    name?: string;
    channel?: MessageTemplateRecord["channel"];
    subject?: string | null;
    body?: string;
  };
  if (!body.name || !body.body) {
    return NextResponse.json({ error: "name e body são obrigatórios" }, { status: 400 });
  }
  const template = saveTemplate({
    id: body.id,
    name: body.name,
    channel: body.channel ?? "universal",
    subject: body.subject ?? null,
    body: body.body,
  });
  return NextResponse.json({ template });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  deleteTemplate(id);
  return NextResponse.json({ ok: true });
}
