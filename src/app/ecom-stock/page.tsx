"use client";

import { useCallback, useEffect, useState } from "react";

interface CreativeBrief {
  kind: string;
  objective: string;
  audience: string;
  hook: string;
  message: string;
  proof: string;
  cta: string;
  format: string;
  complianceNote: string;
  content: string;
}

interface PlanPhase {
  window: string;
  goal: string;
  contents: string[];
}

interface LaunchPlan {
  productName: string;
  positioning: { statement: string; offer: string; landingHeadline: string; landingSub: string; landingCta: string; complianceNote: string };
  phases: PlanPhase[];
  imageBriefs: CreativeBrief[];
  videoBriefs: CreativeBrief[];
  engine: string;
  createdAt: string;
  inputs?: { price: string; proof: string[] };
}

const METRICS = [
  "Visitas (landing)", "Cadastros", "Ativação (1º estoque importado)",
  "Trial/Demo", "Conversão para pago", "Churn", "MRR",
];

export default function EcomStockPage() {
  const [plan, setPlan] = useState<LaunchPlan | null>(null);
  const [icp, setIcp] = useState("Donos de e-commerce com 50-500 pedidos/mês no Brasil");
  const [pains, setPains] = useState("estoque desatualizado; compras por impulso; produto parado");
  const [features, setFeatures] = useState("controle de estoque em tempo real; alertas de ruptura; integração com loja");
  const [proof, setProof] = useState("");
  const [price, setPrice] = useState("R$ 197/mês");
  const [trial, setTrial] = useState("demo guiada + trial de 7 dias sem cartão");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/ecom-stock").then((r) => r.json()).then((d) => setPlan(d.plan)).catch(() => undefined);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/ecom-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: "ECOM Stock",
          icp,
          pains: pains.split(";").map((s) => s.trim()).filter(Boolean),
          features: features.split(";").map((s) => s.trim()).filter(Boolean),
          proof: proof.split(";").map((s) => s.trim()).filter(Boolean),
          price,
          trialModel: trial,
          channels: ["instagram", "email", "whatsapp"],
        }),
      });
      const data = await res.json();
      if (!res.ok) setMsg(data.error ?? "Erro ao gerar plano");
      else {
        setPlan(data.plan);
        setMsg(`Plano gerado (${data.plan.engine === "openai" ? "IA + estrutura" : "estrutura determinística"}). Todos os assets carregam nota de conformidade.`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-white">ECOM Stock · Lançamento</h1>
        <p className="text-sm text-zinc-500">Posicionamento, plano D-14→D+30 e criativos. Nenhum asset afirma o que o produto não comprova.</p>
      </header>
      {msg && <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200">{msg}</div>}

      <section className="space-y-3 rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="text-sm font-semibold text-zinc-100">Entradas do lançamento</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="ICP (cliente ideal)">
            <input value={icp} onChange={(e) => setIcp(e.target.value)} className={inputCls} />
          </Labeled>
          <Labeled label="Preço / oferta">
            <input value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </Labeled>
          <Labeled label="Dores (separe com ; )">
            <input value={pains} onChange={(e) => setPains(e.target.value)} className={inputCls} />
          </Labeled>
          <Labeled label="Funcionalidades REAIS (separe com ; )">
            <input value={features} onChange={(e) => setFeatures(e.target.value)} className={inputCls} />
          </Labeled>
          <Labeled label="Prova disponível (separe com ; ) — vazio = nenhuma">
            <input value={proof} onChange={(e) => setProof(e.target.value)} placeholder="ex: beta com 10 lojas" className={inputCls} />
          </Labeled>
          <Labeled label="Modelo de teste/demo">
            <input value={trial} onChange={(e) => setTrial(e.target.value)} className={inputCls} />
          </Labeled>
        </div>
        <button
          onClick={() => void generate()}
          disabled={busy}
          className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-orange-400 disabled:opacity-40"
        >
          {busy ? "Gerando plano…" : "Gerar plano de lançamento"}
        </button>
      </section>

      {plan && (
        <>
          <section className="space-y-3 rounded-xl border border-emerald-900/50 bg-emerald-950/10 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-emerald-200">Posicionamento & Oferta</h2>
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">{plan.engine === "openai" ? "IA" : "estrutura"} · {new Date(plan.createdAt).toLocaleDateString("pt-BR")}</span>
            </div>
            <CopyBlock label="Statement" text={plan.positioning.statement} />
            <CopyBlock label="Oferta" text={plan.positioning.offer} />
            <CopyBlock label="Landing · Headline" text={plan.positioning.landingHeadline} />
            <CopyBlock label="Landing · Sub" text={plan.positioning.landingSub} />
            <CopyBlock label="Landing · CTA" text={plan.positioning.landingCta} />
            <p className="text-[10px] text-amber-400/80">⚠ {plan.positioning.complianceNote}</p>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-100">Workflow D-14 → D+30</h2>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {plan.phases.map((p) => (
                <div key={p.window} className="rounded-lg bg-zinc-900/60 p-3 text-xs">
                  <p className="font-semibold text-orange-300">{p.window}</p>
                  <p className="mt-0.5 text-zinc-300">{p.goal}</p>
                  <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[11px] text-zinc-500">
                    {p.contents.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <BriefSection title="Briefs de IMAGEM" briefs={plan.imageBriefs} />
          <BriefSection title="Briefs de VÍDEO" briefs={plan.videoBriefs} />

          <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
            <h2 className="mb-2 text-sm font-semibold text-zinc-100">Métricas do lançamento</h2>
            <div className="flex flex-wrap gap-2">
              {METRICS.map((m) => (
                <span key={m} className="rounded-full border border-zinc-800 px-3 py-1 text-[11px] text-zinc-400">{m}</span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">Registrar semanalmente; comparar canais e otimizar o que traz ativação (não só cadastro).</p>
          </section>
        </>
      )}

      {!plan && (
        <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center text-xs text-zinc-600">
          Nenhum plano gerado ainda. Preencha as entradas acima e clique em gerar.
        </p>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-orange-500/40";

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-xs block">
      <span className="font-medium text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-lg bg-zinc-900/70 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-sm text-zinc-200">{text}</p>
    </div>
  );
}

function BriefSection({ title, briefs }: { title: string; briefs: CreativeBrief[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
      <h2 className="mb-3 text-sm font-semibold text-zinc-100">{title} ({briefs.length})</h2>
      <div className="grid gap-2 md:grid-cols-2">
        {briefs.map((b) => (
          <div key={b.objective} className="rounded-lg bg-zinc-900/60 p-3 text-xs">
            <p className="font-semibold text-zinc-200">{b.objective}</p>
            <p className="mt-0.5 text-zinc-400">Hook: {b.hook}</p>
            <button onClick={() => setOpen(open === b.objective ? null : b.objective)} className="mt-1 text-[10px] text-orange-300 hover:underline">
              {open === b.objective ? "ocultar brief" : "ver brief completo"}
            </button>
            {open === b.objective && (
              <>
                <pre className="mt-1.5 whitespace-pre-wrap rounded bg-zinc-950/70 p-2.5 text-[11px] text-zinc-400">{b.content}</pre>
                <p className="mt-1 text-[10px] text-amber-400/80">⚠ {b.complianceNote}</p>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
