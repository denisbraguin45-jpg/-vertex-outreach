"use client";

import { useEffect, useState } from "react";

interface ConfigData {
  dryRun: boolean;
  limits: {
    maxDmsPerDay: number;
    minSeconds: number;
    maxSeconds: number;
    hours: string;
    timezone: string;
    budgetUsd: number;
  };
  integrations: {
    openai: boolean;
    instagramApi: boolean;
    browser: string;
  };
  claims: { verified: string[]; unverified: string[] };
}

export default function ConfiguracoesPage() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setData).catch(() => undefined);
  }, []);

  async function toggleDryRun() {
    setBusy(true);
    await fetch("/api/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun: !data?.dryRun }) });
    setData((d) => (d ? { ...d, dryRun: !d.dryRun } : d));
    setBusy(false);
  }

  if (!data) return <p className="text-sm text-zinc-500">Carregando…</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-white">Configurações</h1>
        <p className="text-sm text-zinc-500">Limites do .env, integrações e regra de afirmações.</p>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Modo dry-run</h2>
            <p className="text-xs text-zinc-500">Quando ativo, nada é enviado de verdade — navegador e API apenas registram.</p>
          </div>
          <button
            onClick={toggleDryRun}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
              data.dryRun ? "bg-amber-500 text-zinc-950" : "bg-zinc-700 text-zinc-300"
            }`}
          >
            {data.dryRun ? "DRY-RUN ATIVO" : "ENVIO REAL"}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-100">Ritmo e limites (.env)</h2>
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <Row label="DMs por dia" value={String(data.limits.maxDmsPerDay)} />
          <Row label="Intervalo entre DMs" value={`${data.limits.minSeconds}s – ${data.limits.maxSeconds}s (aleatório)`} />
          <Row label="Janela de operação" value={`${data.limits.hours} (${data.limits.timezone})`} />
          <Row label="Orçamento OpenAI" value={`US$ ${data.limits.budgetUsd.toFixed(2)} / mês`} />
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-100">Integrações</h2>
        <div className="space-y-2 text-xs">
          <Row label="OpenAI" value={data.integrations.openai ? "configurada" : "NÃO configurada (IA pausada)"} />
          <Row label="API oficial Instagram" value={data.integrations.instagramApi ? "configurada" : "não configurada (conversa continua no navegador até ativar)"} />
          <Row label="Chrome (CDP)" value={data.integrations.browser} />
        </div>
      </section>

      <section className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4">
        <h2 className="mb-2 text-sm font-semibold text-emerald-200">Afirmações verificadas (única fonte permitida)</h2>
        <ul className="list-inside list-disc space-y-1 text-xs text-emerald-100/80">
          {data.claims.verified.map((c, i) => <li key={i}>{c}</li>)}
          {data.claims.verified.length === 0 && <li className="list-none text-zinc-500">Nenhuma — a IA não fará afirmações comerciais.</li>}
        </ul>
      </section>

      <section className="rounded-xl border border-red-900/50 bg-red-950/20 p-4">
        <h2 className="mb-2 text-sm font-semibold text-red-200">Afirmações bloqueadas (nunca enviadas)</h2>
        <ul className="list-inside list-disc space-y-1 text-xs text-red-100/70">
          {data.claims.unverified.map((c, i) => <li key={i}>{c}</li>)}
          {data.claims.unverified.length === 0 && <li className="list-none text-zinc-500">Nenhuma bloqueada no config.</li>}
        </ul>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-zinc-900/60 px-3 py-2">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right font-medium text-zinc-200">{value}</span>
    </div>
  );
}
