"use client";

import { useEffect, useState } from "react";

interface Variant {
  key: string;
  weight: number;
  count: number;
  conversions: number;
}

interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  variable: string;
  status: string;
  variants_json: string;
  min_sample_per_variant: number;
}

export default function ExperimentosPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);

  useEffect(() => {
    const load = () => fetch("/api/experiments").then((r) => r.json()).then((d) => setExperiments(d.experiments)).catch(() => undefined);
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-white">Experimentos</h1>
        <p className="text-sm text-zinc-500">Uma variável por vez · sem vencedor antes da amostra mínima · fatia sempre explorando.</p>
      </header>

      {experiments.map((e) => {
        const variants = JSON.parse(e.variants_json) as Variant[];
        const ready = variants.every((v) => v.count >= e.min_sample_per_variant);
        const sorted = [...variants].sort((a, b) => b.conversions / (b.count || 1) - a.conversions / (a.count || 1));
        const winner = ready && sorted.length >= 2 && sorted[0].count > 0 && sorted[0].conversions / sorted[0].count > (sorted[1].conversions / (sorted[1].count || 1)) * 1.15 ? sorted[0].key : null;
        return (
          <section key={e.id} className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">{e.name}</h2>
                <p className="text-xs text-zinc-500">{e.hypothesis}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${winner ? "bg-emerald-950 text-emerald-300" : ready ? "bg-sky-950 text-sky-300" : "bg-zinc-800 text-zinc-400"}`}>
                {winner ? `vencedor: ${winner}` : ready ? "pronto p/ veredito" : "coletando dados"}
              </span>
            </div>
            <div className="mt-3 space-y-1.5">
              {variants.map((v) => {
                const rate = v.count > 0 ? (v.conversions / v.count) * 100 : 0;
                return (
                  <div key={v.key} className="flex items-center gap-3 text-xs">
                    <span className={`w-24 truncate font-medium ${v.key === winner ? "text-emerald-300" : "text-zinc-300"}`}>{v.key}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-orange-500/70" style={{ width: `${Math.min(100, rate)}%` }} />
                    </div>
                    <span className="w-40 text-right tabular-nums text-zinc-500">
                      {v.conversions}/{v.count} · {rate.toFixed(1)}% · peso {(v.weight * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">Variável: {e.variable} · amostra mínima: {e.min_sample_per_variant}/variante</p>
          </section>
        );
      })}
      {experiments.length === 0 && (
        <p className="rounded-xl border border-zinc-800 bg-[#0D1117] px-4 py-10 text-center text-xs text-zinc-600">
          Nenhum experimento. O primeiro é criado automaticamente quando o worker roda o primeiro contato.
        </p>
      )}
    </div>
  );
}
