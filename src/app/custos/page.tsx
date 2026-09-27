"use client";

import { useEffect, useState } from "react";

interface CostData {
  monthTotal: number;
  budget: number;
  byModel: Array<{ model: string; calls: number; tokens: number; cost: number }>;
  perLead: number;
  leadsContacted: number;
  customers: number;
  costPerCustomer: number | null;
}

export default function CustosPage() {
  const [data, setData] = useState<CostData | null>(null);

  useEffect(() => {
    const load = () => fetch("/api/costs").then((r) => r.json()).then(setData).catch(() => undefined);
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, []);

  if (!data) return <p className="text-sm text-zinc-500">Carregando…</p>;

  const pct = Math.min(100, (data.monthTotal / (data.budget || 1)) * 100);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-white">Custos de IA</h1>
        <p className="text-sm text-zinc-500">Sem custo por lead e por cliente ativo, não dá para saber se a automação dá lucro.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Gasto no mês</p>
          <p className="text-2xl font-bold text-orange-400">US$ {data.monthTotal.toFixed(4)}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className={`h-full rounded-full ${pct > 90 ? "bg-red-500" : "bg-orange-500"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-zinc-600">orçamento: US$ {data.budget.toFixed(2)} ({pct.toFixed(0)}%)</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Custo por lead abordado</p>
          <p className="text-2xl font-bold text-zinc-100">
            US$ {data.leadsContacted > 0 ? (data.monthTotal / data.leadsContacted).toFixed(4) : "—"}
          </p>
          <p className="mt-1 text-[11px] text-zinc-600">{data.leadsContacted} leads abordados</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Custo por cliente ativo</p>
          <p className="text-2xl font-bold text-zinc-100">
            {data.costPerCustomer !== null ? `US$ ${data.costPerCustomer.toFixed(4)}` : "—"}
          </p>
          <p className="mt-1 text-[11px] text-zinc-600">{data.customers} clientes ativos</p>
        </div>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-[#0D1117]">
        <h2 className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-200">Por modelo</h2>
        <div className="divide-y divide-zinc-800/70">
          {data.byModel.map((m) => (
            <div key={m.model} className="flex items-center justify-between px-4 py-2.5 text-xs">
              <span className="font-medium text-zinc-300">{m.model}</span>
              <span className="text-zinc-500">{m.calls} chamadas · {m.tokens.toLocaleString("pt-BR")} tokens</span>
              <span className="tabular-nums text-zinc-300">US$ {m.cost.toFixed(4)}</span>
            </div>
          ))}
          {data.byModel.length === 0 && <p className="px-4 py-8 text-center text-xs text-zinc-600">Nenhuma chamada de IA no mês.</p>}
        </div>
      </section>
    </div>
  );
}
