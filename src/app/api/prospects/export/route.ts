import { NextRequest, NextResponse } from "next/server";
import { listProspects, type ProspectStatus } from "@/db/prospects";

export const dynamic = "force-dynamic";

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const prospects = listProspects({
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
    limit: 1_000_000,
  });

  const header = [
    "Empresa", "Nicho", "Cidade", "Estado", "Telefone", "WhatsApp", "E-mail",
    "Instagram", "Site", "Endereço", "Google Maps", "Avaliação", "Nº Avaliações",
    "Status", "Último contato", "Último canal", "Fonte", "Criado em",
  ];
  const lines = [header.join(";")];
  for (const p of prospects) {
    lines.push([
      p.company_name, p.niche, p.city, p.state, p.phone, p.whatsapp, p.email,
      p.instagram, p.website, p.address, p.google_maps_url,
      p.google_rating ?? "", p.google_reviews_count ?? "",
      p.status, p.last_contacted_at, p.last_channel, p.source, p.created_at,
    ].map(csvCell).join(";"));
  }

  // BOM + ; para abrir direto no Excel PT-BR
  const csv = "\uFEFF" + lines.join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="base-contatos-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
