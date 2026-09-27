import { NextRequest, NextResponse } from "next/server";
import {
  listDelivery, setDeliveryStage, listReferrals, requestReferral, updateReferral,
  convertReferralToProspect, listExpansionSignals, addExpansionSignal, setExpansionStatus,
  addSpend, moneyModel, growthCounters, type DeliveryStage, type ExpansionSignal,
} from "@/db/growth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    delivery: listDelivery(),
    referrals: listReferrals(),
    expansions: listExpansionSignals(),
    money: moneyModel(),
    counters: growthCounters(),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Record<string, unknown>;
  const action = String(body.action ?? "");

  switch (action) {
    case "set-delivery": {
      const rec = setDeliveryStage(String(body.dealId), String(body.stage) as DeliveryStage);
      if (!rec) return NextResponse.json({ error: "deal não encontrado" }, { status: 404 });
      return NextResponse.json({ delivery: rec });
    }

    case "request-referral": {
      const kind = String(body.kind);
      if (!["depoimento", "case", "indicacao"].includes(kind) || !body.prospectId) {
        return NextResponse.json({ error: "prospectId e kind (depoimento|case|indicacao) obrigatórios" }, { status: 400 });
      }
      const rec = requestReferral({
        prospectId: String(body.prospectId),
        kind: kind as "depoimento" | "case" | "indicacao",
        content: body.content ? String(body.content) : null,
      });
      return NextResponse.json({ referral: rec });
    }

    case "update-referral": {
      const status = String(body.status);
      if (!body.id || !["recebido", "publicado", "recusado"].includes(status)) {
        return NextResponse.json({ error: "id e status válidos obrigatórios" }, { status: 400 });
      }
      updateReferral(String(body.id), status as "recebido" | "publicado" | "recusado", body.content ? String(body.content) : undefined);
      return NextResponse.json({ ok: true });
    }

    case "convert-referral": {
      const res = convertReferralToProspect(String(body.id), String(body.companyName ?? ""));
      if (!res) return NextResponse.json({ error: "indicação não encontrada ou nome vazio" }, { status: 422 });
      return NextResponse.json(res);
    }

    case "add-expansion": {
      const signal = String(body.signal);
      if (!body.prospectId || !signal || !body.detail) {
        return NextResponse.json({ error: "prospectId, signal e detail obrigatórios" }, { status: 400 });
      }
      const rec = addExpansionSignal({
        prospectId: String(body.prospectId),
        signal: signal as ExpansionSignal,
        detail: String(body.detail),
      });
      if (!rec) return NextResponse.json({ error: "detalhe do sinal é obrigatório (nada inventado)" }, { status: 422 });
      return NextResponse.json({ expansion: rec });
    }

    case "set-expansion-status": {
      if (!body.id || !body.status) return NextResponse.json({ error: "id e status obrigatórios" }, { status: 400 });
      setExpansionStatus(String(body.id), String(body.status) as "detectada" | "oferecida" | "aceita" | "descartada");
      return NextResponse.json({ ok: true });
    }

    case "add-spend": {
      if (!body.channel || body.amountCents === undefined) {
        return NextResponse.json({ error: "channel e amountCents obrigatórios" }, { status: 400 });
      }
      addSpend({ channel: String(body.channel), amountCents: Number(body.amountCents), note: body.note ? String(body.note) : null });
      return NextResponse.json({ ok: true });
    }

    case "set-deal-recurrence": {
      const { getDb } = await import("@/db");
      if (!body.dealId) return NextResponse.json({ error: "dealId obrigatório" }, { status: 400 });
      getDb().prepare("UPDATE deals SET recurrence_monthly_cents = ?, updated_at = ? WHERE id = ?")
        .run(Math.max(0, Math.round(Number(body.monthlyCents ?? 0))), new Date().toISOString(), String(body.dealId));
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `ação desconhecida: ${action}` }, { status: 400 });
  }
}
