import { NextRequest, NextResponse } from "next/server";
import { upsertProspect } from "@/db/prospects";

export const dynamic = "force-dynamic";

/**
 * Criação manual de contatos (e importação de listas externas).
 * Fonte "manual": nunca sobrescrito pelo scraper. Dedupe por sourceId
 * determinístico (slug do nome + cidade), então reimportar não duplica.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    companyName?: string;
    niche?: string;
    city?: string;
    state?: string;
    phone?: string;
    whatsapp?: string;
    email?: string;
    instagram?: string;
    website?: string;
    address?: string;
    items?: Array<Record<string, string>>;
  };

  const normalize = (raw: Record<string, string>) => {
    const name = (raw.companyName ?? raw.nome ?? "").trim();
    if (!name) return null;
    const city = (raw.city ?? raw.cidade ?? "").trim() || null;
    return {
      source: "manual" as const,
      sourceId: `manual/${name.toLowerCase().replace(/\s+/g, "-")}${city ? `-${city.toLowerCase().replace(/\s+/g, "-")}` : ""}`,
      companyName: name,
      niche: (raw.niche ?? raw.nicho ?? "").trim() || null,
      city,
      state: (raw.state ?? raw.uf ?? "").trim() || null,
      phone: (raw.phone ?? raw.telefone ?? "").trim() || null,
      whatsapp: (raw.whatsapp ?? "").trim() || null,
      email: (raw.email ?? "").trim() || null,
      instagram: (raw.instagram ?? "").trim().replace(/^@/, "") || null,
      website: (raw.website ?? raw.site ?? "").trim() || null,
      address: (raw.address ?? raw.endereco ?? "").trim() || null,
    };
  };

  const inputs = body.items
    ? body.items.map(normalize).filter((x): x is NonNullable<typeof x> => x !== null)
    : [normalize(body as Record<string, string>)].filter((x): x is NonNullable<typeof x> => x !== null);

  if (!inputs.length) {
    return NextResponse.json({ error: "informe companyName (ou items[] para lote)" }, { status: 400 });
  }

  let created = 0;
  let updated = 0;
  const prospects = [];
  for (const input of inputs) {
    const res = upsertProspect(input);
    if (res.created) created += 1;
    else updated += 1;
    prospects.push(res.prospect);
  }

  return NextResponse.json({ created, updated, total: prospects.length, prospects });
}
