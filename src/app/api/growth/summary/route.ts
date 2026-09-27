import { NextResponse } from "next/server";
import { prospectCounters, outreachCounters } from "@/db/prospects";
import { comercialCounters } from "@/db/comercial";
import { marketingCounters } from "@/db/marketing";
import { moneyModel, growthCounters } from "@/db/growth";

export const dynamic = "force-dynamic";

export async function GET() {
  const prospects = prospectCounters();
  const outreach = outreachCounters();
  const comercial = comercialCounters();
  const marketing = marketingCounters();
  const money = moneyModel();
  const growth = growthCounters();

  // "Contatos utilizáveis": com pelo menos um canal
  const usable = prospects.withWhatsapp + prospects.withEmail + prospects.withInstagram;

  // Ticket médio dos ganhos
  const avgTicketCents = comercial.wonCount > 0 ? Math.round(comercial.wonValueCents / comercial.wonCount) : 0;

  // Respostas = prospects que responderam (status) — proxy de reply rate
  const replied = prospects.byStatus.respondeu ?? 0;

  return NextResponse.json({
    aquisicao: {
      empresasEncontradas: prospects.total,
      contatosUsaveis: usable,
      enviados: outreach.total,
      enviadosHoje: outreach.today,
      respostas: replied,
      qualificados: prospects.byStatus.interessado ?? 0,
    },
    comercial: {
      reunioes: comercial.meetingsTotal,
      propostas: comercial.deals.proposta + comercial.deals.negociacao,
      vendas: comercial.wonCount,
      valorVendidoCents: comercial.wonValueCents,
      ticketMedioCents: avgTicketCents,
      pipelineAbertoCents: comercial.dealValueCents.proposta + comercial.dealValueCents.negociacao,
    },
    marketing: marketing,
    inboxNovos: comercial.inboxNew,
    porCanal: outreach.byChannel,
    moneyModel: {
      receitaInicialCents: money.revenueInitialCents,
      mrrCents: money.mrrCents,
      cacCents: money.cacCents,
      cacPorCanalCents: money.cacByChannelCents,
      ltvCents: money.ltvCents,
      paybackMeses: money.paybackMonths,
    },
    posVenda: {
      entregaPorEtapa: growth.deliveryByStage,
      indicacoesAbertas: growth.referralsOpen,
      casesPublicados: growth.referralsPublished,
      expansoesAbertas: growth.expansionsOpen,
      expansoesAceitas: growth.expansionsAccepted,
    },
  });
}
