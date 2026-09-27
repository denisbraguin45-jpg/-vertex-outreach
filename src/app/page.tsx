"use client";

import { useEffect, useState } from "react";

interface StatusData {
  paused: boolean;
  reason: string;
  dryRun: boolean;
  queue: number;
  leads: Array<{ funnel: string; pipeline: string; channel: string; count: number }>;
  aiCost: { monthTotal: number; byModel: Array<{ model: string; calls: number; cost: number }> };
  recentEvents: Array<{ id: string; level: string; kind: string; created_at: string }>;
}

interface GrowthSummary {
  aquisicao: { empresasEncontradas: number; contatosUsaveis: number; enviados: number; enviadosHoje: number; respostas: number; qualificados: number };
  comercial: { reunioes: number; propostas: number; vendas: number; valorVendidoCents: number; ticketMedioCents: number; pipelineAbertoCents: number };
  marketing: { research: number; briefs: number; calendar: number; published: number };
  inboxNovos: number;
  moneyModel: { receitaInicialCents: number; mrrCents: number; cacCents: number | null; cacPorCanalCents: Record<string, number>; ltvCents: number | null; paybackMeses: number | null };
  posVenda: { entregaPorEtapa: Record<string, number>; indicacoesAbertas: number; casesPublicados: number; expansoesAbertas: number; expansoesAceitas: number };
}

const PIPELINE_LABELS: Record<string, string> = {
  discovered: "Descoberto", qualified: "Qualificado", contacted: "Abordado", replied: "Respondeu",
  interested: "Interessado", whatsapp_handoff: "Encaminhado ao WhatsApp", registered: "Cadastrado",
  active_customer: "Cliente ativo", joined_affiliate_group: "Entrou no grupo", active_affiliate: "Afiliado ativo",
  generated_customer: "Gerou cliente", closed: "Encerrado",
};

const FUNNEL_LABELS: Record<string, string> = { clients: "Clientes", affiliates: "Afiliados" };

export default function DashboardPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [growth, setGrowth] = useState<GrowthSummary | null>(null);

  useEffect(() => {
    const load = () => fetch("/api/status").then((r) => r.json()).then(setData).catch(() => undefined);
    const loadGrowth = () => fetch("/api/growth/summary").then((r) => r.json()).then(setGrowth).catch(() => undefined);
    load();
    loadGrowth();
    const t = setInterval(load, 10_000);
    const tg = setInterval(loadGrowth, 30_000);
    return () => { clearInterval(t); clearInterval(tg); };
  }, []);

  if (!data) return <p className="text-sm text-zinc-500">Carregando painel…</p>;

  const byFunnel = (funnel: string) => data.leads.filter((l) => l.funnel === funnel);
  const sum = (rows: StatusData["leads"], key: "pipeline" | "channel") =>
    Object.entries(
      rows.reduce<Record<string, number>>((acc, r) => ((acc[r[key]] = (acc[r[key]] ?? 0) + r.count), acc), {}),
    ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Visão Geral</h1>
          <p className="text-sm text-zinc-500">Ciclo autônomo: observar → decidir → agir → medir → aprender → adaptar</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded-full px-3 py-1 font-medium ${data.paused ? "bg-red-950 text-red-300" : "bg-emerald-950 text-emerald-300"}`}>
            {data.paused ? "SISTEMA PAUSADO" : "OPERANDO"}
          </span>
          {data.dryRun && <span className="rounded-full bg-amber-950 px-3 py-1 font-medium text-amber-300">DRY-RUN (nada é enviado)</span>}
          <span className="rounded-full bg-zinc-800 px-3 py-1 text-zinc-300">{data.queue} jobs na fila</span>
        </div>
      </header>

      {data.paused && data.reason && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          ⚠ {data.reason}
        </div>
      )}

      {/* Growth OS: aquisição → comercial */}
      {growth && (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-200">Aquisição (multicanal)</h2>
            <div className="grid grid-cols-3 gap-2">
              <GStat label="Empresas" value={growth.aquisicao.empresasEncontradas} />
              <GStat label="Usáveis" value={growth.aquisicao.contatosUsaveis} />
              <GStat label="Enviados" value={growth.aquisicao.enviados} />
              <GStat label="Respostas" value={growth.aquisicao.respostas} />
              <GStat label="Qualificados" value={growth.aquisicao.qualificados} />
              <GStat label="Hoje" value={growth.aquisicao.enviadosHoje} />
            </div>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-200">Comercial</h2>
            <div className="grid grid-cols-3 gap-2">
              <GStat label="Reuniões" value={growth.comercial.reunioes} />
              <GStat label="Propostas" value={growth.comercial.propostas} />
              <GStat label="Vendas" value={growth.comercial.vendas} />
              <GStat label="Ticket médio" value={(growth.comercial.ticketMedioCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} />
              <GStat label="Vendido" value={(growth.comercial.valorVendidoCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} />
              <GStat label="Em aberto" value={(growth.comercial.pipelineAbertoCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} />
            </div>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-200">Marketing & ECOM Stock</h2>
            <div className="grid grid-cols-3 gap-2">
              <GStat label="Pesquisas" value={growth.marketing.research} />
              <GStat label="Criativos" value={growth.marketing.briefs} />
              <GStat label="Publicados" value={growth.marketing.published} />
              <GStat label="Inbox novo" value={growth.inboxNovos} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <a href="/prospeccao" className="rounded bg-zinc-800/80 px-2 py-1 text-zinc-300 hover:bg-zinc-800">+ Coletar</a>
              <a href="/disparo" className="rounded bg-zinc-800/80 px-2 py-1 text-zinc-300 hover:bg-zinc-800">+ Disparar</a>
              <a href="/comercial" className="rounded bg-zinc-800/80 px-2 py-1 text-zinc-300 hover:bg-zinc-800">Comercial</a>
              <a href="/ecom-stock" className="rounded bg-orange-500/90 px-2 py-1 font-medium text-zinc-950 hover:bg-orange-400">ECOM Stock</a>
            </div>
          </section>
        </div>
      )}

      {/* Money Model + Pós-venda */}
      {growth && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-orange-900/40 bg-[#0D1117] p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-200">Money Model</h2>
            <div className="grid grid-cols-3 gap-2">
              <GStat label="Receita inicial" value={(growth.moneyModel.receitaInicialCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} />
              <GStat label="MRR" value={(growth.moneyModel.mrrCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} />
              <GStat label="CAC" value={growth.moneyModel.cacCents === null ? "—" : (growth.moneyModel.cacCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} />
              <GStat label="LTV (6m)" value={growth.moneyModel.ltvCents === null ? "—" : (growth.moneyModel.ltvCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} />
              <GStat label="Payback" value={growth.moneyModel.paybackMeses === null ? "—" : `${growth.moneyModel.paybackMeses} meses`} />
              <GStat label="Canais pagos" value={Object.keys(growth.moneyModel.cacPorCanalCents).length} />
            </div>
            <p className="mt-2 text-[10px] text-zinc-600">Registre gastos por canal em /api/growth (action: add-spend) e recorrência dos deals para CAC/LTV/payback reais.</p>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-200">Pós-venda (entrega · prova · expansão)</h2>
            <div className="grid grid-cols-3 gap-2">
              <GStat label="Em entrega" value={Object.entries(growth.posVenda.entregaPorEtapa).filter(([s]) => s !== "ENTREGUE" && s !== "RECORRÊNCIA").reduce((a, [, n]) => a + n, 0)} />
              <GStat label="Recorrência" value={growth.posVenda.entregaPorEtapa["RECORRÊNCIA"] ?? 0} />
              <GStat label="Indicações abertas" value={growth.posVenda.indicacoesAbertas} />
              <GStat label="Cases publicados" value={growth.posVenda.casesPublicados} />
              <GStat label="Expansões abertas" value={growth.posVenda.expansoesAbertas} />
              <GStat label="Expansões aceitas" value={growth.posVenda.expansoesAceitas} />
            </div>
          </section>
        </div>
      )}

      {/* Funis */}
      <div className="grid gap-4 lg:grid-cols-2">
        {["clients", "affiliates"].map((funnel) => (
          <section key={funnel} className="rounded-xl border border-zinc-800 bg-[#0D1117]">
            <h2 className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-200">
              Funil · {FUNNEL_LABELS[funnel]}
            </h2>
            <div className="grid grid-cols-2 gap-px bg-zinc-800/60 sm:grid-cols-3">
              {sum(byFunnel(funnel), "pipeline").map(([state, count]) => (
                <div key={state} className="bg-[#0D1117] px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">{PIPELINE_LABELS[state] ?? state}</p>
                  <p className="text-lg font-semibold text-zinc-100">{count}</p>
                </div>
              ))}
              {byFunnel(funnel).length === 0 && (
                <p className="col-span-full px-4 py-6 text-center text-xs text-zinc-600">
                  Nenhum lead ainda — o worker roda a descoberta automaticamente.
                </p>
              )}
            </div>
          </section>
        ))}
      </div>

      {/* Custos + eventos */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-200">Custo de IA no mês</h2>
          <p className="text-2xl font-bold text-orange-400">US$ {data.aiCost.monthTotal.toFixed(4)}</p>
          <div className="mt-3 space-y-1.5">
            {data.aiCost.byModel.map((m) => (
              <div key={m.model} className="flex items-center justify-between text-xs text-zinc-400">
                <span>{m.model} · {m.calls} chamadas</span>
                <span className="tabular-nums">US$ {m.cost.toFixed(4)}</span>
              </div>
            ))}
            {data.aiCost.byModel.length === 0 && <p className="text-xs text-zinc-600">Sem chamadas registradas.</p>}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-200">Log de decisões (recentes)</h2>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {data.recentEvents.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-xs">
                <span className={e.level === "error" ? "text-red-400" : e.level === "warn" ? "text-amber-400" : "text-zinc-500"}>●</span>
                <span className="text-zinc-300">{e.kind}</span>
                <span className="ml-auto text-zinc-600">{new Date(e.created_at).toLocaleTimeString("pt-BR")}</span>
              </div>
            ))}
            {data.recentEvents.length === 0 && <p className="text-xs text-zinc-600">Sem eventos.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function GStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-zinc-900/60 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-zinc-100">{value}</p>
    </div>
  );
}
