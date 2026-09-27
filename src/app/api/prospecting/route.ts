import { NextRequest, NextResponse } from "next/server";
import { enqueueProspecting, lastProspectingState } from "@/features/prospecting/job";
import { NICHOS } from "@/features/prospecting/nichos";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    state: lastProspectingState(),
    nichos: NICHOS.map((n) => ({ id: n.id, label: n.label, places: n.placesKeywords.length > 0 })),
    placesConfigured: Boolean(process.env.GOOGLE_PLACES_API_KEY),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { nicho?: string; location?: string; limit?: number; usePlaces?: boolean };
  const nicho = (body.nicho ?? "").trim();
  const location = (body.location ?? "").trim();
  const limit = Number(body.limit ?? 100);
  if (!nicho) return NextResponse.json({ error: "Informe o nicho" }, { status: 400 });
  if (!location) return NextResponse.json({ error: "Informe a localização" }, { status: 400 });
  if (!Number.isFinite(limit) || limit < 1 || limit > 5000) {
    return NextResponse.json({ error: "Quantidade deve estar entre 1 e 5000" }, { status: 400 });
  }
  const jobId = enqueueProspecting({ nicho, location, limit: Math.floor(limit), usePlaces: body.usePlaces });
  return NextResponse.json({ jobId, state: lastProspectingState() });
}
