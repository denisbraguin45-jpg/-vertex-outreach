"use client";

import { useCallback, useEffect, useState } from "react";

interface ResearchEntry {
  id: string;
  market: string;
  kind: string;
  content: string;
  source: string | null;
  created_at: string;
}

interface Brief {
  id: string;
  kind: string;
  title: string;
  hook: string | null;
  proof: string | null;
  cta: string | null;
  format: string | null;
  compliance_note: string | null;
  content: string;
  created_at: string;
}

interface CalendarItem {
  id: string;
  title: string;
  channel: string;
  planned_date: string | null;
  status: string;
}

const KINDS = ["dor", "objecao", "oferta_concorrente", "angulo", "hipotese"] as const;
const ASSETS = ["hook", "post", "email", "anuncio", "roteiro_video", "brief_imagem"] as const;

const KIND_LABEL: Record<string, string> = {
  dor: "Dor", objecao: "Objeção", oferta_concorrente: "Oferta concorrente",
  angulo: "Ângulo", hipotese: "Hipótese",
};

const ASSET_LABEL: Record<string, string> = {
  hook: "Hooks", post: "Post", email: "E-mail",
  anuncio: "Anúncio", roteiro_video: "Roteiro vídeo", brief_imagem: "Brief imagem",
};

export default function MarketingPage() {
  const [research, setResearch] = useState<ResearchEntry[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [calendar, setCalendar] = useState<CalendarItem[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [market, setMarket] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("dor");
  const [content, setContent] = useState("");
  const [assetKind, setAssetKind] = useState<(typeof ASSETS)[number]>("hook");
  const [offer, setOffer] = useState("");
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/marketing")
      .then((r) => r.json())
      .then((d) => {
        setResearch(d.research ?? []);
        setBriefs(d.briefs ?? []);
        setCalendar(d.calendar ?? []);
        setMarkets([...new Set<string>((d.research ?? []).map((r: ResearchEntry) => r.market))]);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function post(payload: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) setMsg(data.error ?? "Erro");
      else {
        setMsg(successMsg);
        load();
        return data;
      }
    } finally {
      setBusy(false);
    }
    return null;
  }

  async function generate() {
    if (!market.trim()) {
      setMsg("Informe o mercado.");
      return;
    }
    const data = await post(
      { action: "generate", market, kind: assetKind, offer: offer || undefined, proof: proof || undefined },
      "",
    );
    if (data?.result) {
      setMsg(`Asset gerado (${data.result.engine === "openai" ? "IA" : "estrutura determinística"}). Revise a nota de conformidade antes de usar.`);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-white">Marketing OS</h1>
        <p className="text-sm text-zinc-500">Pesquisa → ofertário criativo: hooks, posts, e-mails, anúncios, roteiros e briefs. Nenhum asset afirma prova que não existe.</p>
      </header>
      {msg && <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200">{msg}</div>}

      {/* Registrar pesquisa */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="text-sm font-semibold text-zinc-100">1 · Registrar pesquisa</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <input value={market} onChange={(e) => setMarket(e.target.value)} placeholder="Mercado (ex: clínicas odontológicas)" list="markets" className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600" />
          <datalist id="markets">{markets.map((m) => <option key={m} value={m} />)}</datalist>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="Ex: 'perdem agendamentos por WhatsApp'" className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600" />
        </div>
        <button
          onClick={() => void post({ action: "add-research", market, kind, content }, "Pesquisa registrada.")}
          disabled={busy || !market.trim() || !content.trim()}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40"
        >
          Adicionar à pesquisa
        </button>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {research.slice(0, 18).map((r) => (
            <span key={r.id} className="group flex items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-400">
              <b className="font-medium text-zinc-300">{KIND_LABEL[r.kind] ?? r.kind}</b> {r.content.slice(0, 60)}
              <button onClick={() => void post({ action: "delete-research", id: r.id }, "")} className="text-zinc-700 hover:text-red-400">×</button>
            </span>
          ))}
        </div>
      </section>

      {/* Gerar assets */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="text-sm font-semibold text-zinc-100">2 · Gerar criativos a partir da pesquisa</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={assetKind} onChange={(e) => setAssetKind(e.target.value as typeof assetKind)} className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">
            {ASSETS.map((a) => <option key={a} value={a}>{ASSET_LABEL[a]}</option>)}
          </select>
          <input value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="Mecanismo/oferta (ex: automação de agendamento)" className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600" />
          <input value={proof} onChange={(e) => setProof(e.target.value)} placeholder="Prova REAL disponível (opcional — deixe vazio se não houver)" className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 sm:col-span-2" />
        </div>
        <button
          onClick={() => void generate()}
          disabled={busy}
          className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-orange-400 disabled:opacity-40"
        >
          {busy ? "Gerando…" : `Gerar ${ASSET_LABEL[assetKind]}`}
        </button>
      </section>

      {/* Briefs gerados */}
      <section className="space-y-2 rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="text-sm font-semibold text-zinc-100">Banco de criativos ({briefs.length})</h2>
        {briefs.slice(0, 10).map((b) => (
          <details key={b.id} className="rounded-lg bg-zinc-900/60 p-3 text-xs">
            <summary className="cursor-pointer font-medium text-zinc-200">
              {ASSET_LABEL[b.kind] ?? b.kind} · {b.title}
              <span className="ml-2 text-[10px] text-zinc-600">{new Date(b.created_at).toLocaleDateString("pt-BR")}</span>
            </summary>
            <pre className="mt-2 whitespace-pre-wrap rounded bg-zinc-950/70 p-2.5 text-[11px] text-zinc-300">{b.content}</pre>
            <p className="mt-1.5 text-[10px] text-amber-400/80">⚠ {b.compliance_note}</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => void post({ action: "add-calendar", title: b.title, channel: b.kind, briefId: b.id }, "Adicionado ao calendário.")}
                className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800"
              >
                → Calendário
              </button>
              <button onClick={() => void post({ action: "delete-brief", id: b.id }, "")} className="rounded border border-zinc-800 px-2 py-1 text-[10px] text-zinc-600 hover:text-red-400">excluir</button>
            </div>
          </details>
        ))}
        {briefs.length === 0 && <p className="py-4 text-center text-xs text-zinc-600">Nenhum criativo ainda. Registre pesquisa e gere o primeiro asset.</p>}
      </section>

      {/* Calendário */}
      <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-100">Calendário editorial ({calendar.length})</h2>
        <div className="space-y-1.5">
          {calendar.slice(0, 15).map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg bg-zinc-900/50 px-3 py-1.5 text-xs">
              <span className="flex-1 truncate text-zinc-300">{c.title}</span>
              <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{c.channel}</span>
              <select
                value={c.status}
                onChange={(e) => void post({ action: "set-calendar-status", id: c.id, status: e.target.value }, "")}
                className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300"
              >
                {["planejado", "producao", "publicado"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ))}
          {calendar.length === 0 && <p className="py-4 text-center text-xs text-zinc-600">Calendário vazio — gere criativos e envie para o calendário.</p>}
        </div>
      </section>
    </div>
  );
}
