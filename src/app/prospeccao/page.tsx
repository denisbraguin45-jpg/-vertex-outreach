"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface NichoInfo {
  id: string;
  label: string;
  places: boolean;
}

interface ProspectingState {
  jobId: string;
  status: "queued" | "running" | "done" | "failed";
  criteria: { nicho: string; location: string; limit: number } | null;
  result: { found: number; newProspects: number; duplicates: number; placesUsed: boolean; errors: string[] } | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  running: "Coletando…",
  done: "Concluído",
  failed: "Falhou",
};

export default function ProspeccaoPage() {
  const [nichos, setNichos] = useState<NichoInfo[]>([]);
  const [nicho, setNicho] = useState("concessionarias");
  const [location, setLocation] = useState("São Paulo");
  const [limit, setLimit] = useState(5000);
  const [state, setState] = useState<ProspectingState | null>(null);
  const [placesConfigured, setPlacesConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/prospecting")
      .then((r) => r.json())
      .then((d) => {
        setNichos(d.nichos ?? []);
        setPlacesConfigured(Boolean(d.placesConfigured));
        if (d.state) setState(d.state);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const active = state && (state.status === "queued" || state.status === "running");
    if (!active) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [state, load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/prospecting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nicho, location, limit }),
      });
      const data = await res.json();
      if (!res.ok) setMsg(data.error ?? "Erro ao enfileirar");
      else setState(data.state);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-white">Prospecção</h1>
        <p className="text-sm text-zinc-500">
          Coleta empresas por nicho e localização. Sem qualificação — todo contato entra na base e a triagem é sua.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-4 rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1.5 text-xs">
            <span className="font-medium text-zinc-400">Nicho</span>
            <select
              value={nicho}
              onChange={(e) => setNicho(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-orange-500/40"
            >
              {nichos.map((n) => (
                <option key={n.id} value={n.id}>{n.label}</option>
              ))}
              {nichos.length === 0 && <option value="outros">Outros</option>}
            </select>
          </label>
          <label className="space-y-1.5 text-xs">
            <span className="font-medium text-zinc-400">Localização</span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Cidade, UF ou região (ex: São Paulo)"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-orange-500/40"
            />
          </label>
          <label className="space-y-1.5 text-xs">
            <span className="font-medium text-zinc-400">Quantidade desejada</span>
            <input
              type="number"
              min={1}
              max={5000}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm tabular-nums text-zinc-200 focus:outline-none focus:ring-1 focus:ring-orange-500/40"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || state?.status === "running" || state?.status === "queued"}
            className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-orange-400 disabled:opacity-40"
          >
            {state?.status === "running" || state?.status === "queued" ? "Coleta em andamento…" : "Buscar empresas"}
          </button>
          {!placesConfigured && (
            <span className="text-[11px] text-zinc-600">
              Dica: configure GOOGLE_PLACES_API_KEY para incluir avaliação e link do Google Maps.
            </span>
          )}
        </div>
        {msg && <p className="text-xs text-red-400">{msg}</p>}
      </form>

      {state && (
        <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-100">Última coleta</h2>
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                state.status === "done"
                  ? "bg-emerald-950 text-emerald-300"
                  : state.status === "failed"
                    ? "bg-red-950 text-red-300"
                    : "bg-amber-950 text-amber-300"
              }`}
            >
              {STATUS_LABEL[state.status] ?? state.status}
            </span>
          </div>
          {state.criteria && (
            <p className="mt-1 text-xs text-zinc-500">
              Nicho: {state.criteria.nicho} · Local: {state.criteria.location} · Quantidade: {state.criteria.limit.toLocaleString("pt-BR")}
            </p>
          )}
          {state.result && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Encontradas" value={state.result.found} />
              <Stat label="Novas na base" value={state.result.newProspects} />
              <Stat label="Duplicadas" value={state.result.duplicates} />
              <Stat label="Google Places" value={state.result.placesUsed ? "usado" : "não"} isText />
            </div>
          )}
          {state.error && <p className="mt-3 text-xs text-red-400">{state.error}</p>}
          {state.result?.errors?.length ? (
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-amber-400/80">
              {state.result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          ) : null}
          {state.status === "done" && (
            <Link
              href="/contatos"
              className="mt-3 inline-block rounded-lg border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
            >
              Abrir base de contatos →
            </Link>
          )}
        </section>
      )}

      <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-100">Como funciona</h2>
        <ul className="list-inside list-disc space-y-1 text-xs text-zinc-500">
          <li>Fontes públicas: OpenStreetMap (Overpass) para volume + Google Places opcional (avaliações, Maps).</li>
          <li>A coleta respeita os rate limits oficiais; lotes grandes podem levar alguns minutos.</li>
          <li>Duplicatas são ignoradas automaticamente — rodar duas vezes não suja a base.</li>
          <li>Contato em opt-out nunca volta para a base nem recebe disparos.</li>
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, isText }: { label: string; value: number | string; isText?: boolean }) {
  return (
    <div className="rounded-lg bg-zinc-900/60 px-3 py-2">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className={`font-semibold text-zinc-100 ${isText ? "text-xs" : "tabular-nums"}`}>{value}</p>
    </div>
  );
}
