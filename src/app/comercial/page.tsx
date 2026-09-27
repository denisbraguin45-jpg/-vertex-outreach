"use client";

import { useCallback, useEffect, useState } from "react";

interface Prospect {
  id: string;
  company_name: string;
  niche: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  status: string;
  notes: string | null;
  last_channel: string | null;
}

interface InboxItem {
  id: string;
  prospect_id: string;
  channel: string;
  body: string;
  intent: string | null;
  summary: string | null;
  suggests_meeting: number;
  status: string;
  created_at: string;
}

interface Deal {
  id: string;
  prospect_id: string;
  title: string;
  value_cents: number;
  stage: string;
  notes: string | null;
}

interface GrowthData {
  delivery: Array<{ deal_id: string; prospect_id: string; stage: string; company_name: string; deal_title: string; value_cents: number }>;
  referrals: Array<{ id: string; company_name: string; kind: string; status: string; content: string | null; created_at: string }>;
  expansions: Array<{ id: string; company_name: string; signal: string; detail: string; status: string; created_at: string }>;
}

interface Meeting {
  id: string;
  prospect_id: string;
  scheduled_at: string | null;
  brief: string | null;
  notes: string | null;
  summary: string | null;
  objections: string | null;
  next_step: string | null;
  created_at: string;
}

const DELIVERY_STAGES = ["VENDIDO", "ONBOARDING", "EM PRODUÇÃO", "REVISÃO", "PRONTO", "ENTREGUE", "RECORRÊNCIA"] as const;

const EXPANSION_LABEL: Record<string, string> = {
  novo_servico: "Novo serviço",
  automacao: "Automação",
  manutencao: "Manutenção",
  modulo: "Módulo",
  expansao_contrato: "Expansão de contrato",
};

const REFERRAL_LABEL: Record<string, string> = {
  depoimento: "Depoimento",
  case: "Case",
  indicacao: "Indicação",
};

const INTENT_LABEL: Record<string, string> = {
  interesse: "Interesse",
  pediu_informacao: "Pediu info",
  pediu_preco: "Pediu preço",
  objecao: "Objeção",
  sem_interesse: "Sem interesse",
  opt_out: "Opt-out",
  nao_eh_decisor: "Não é decisor",
  encaminhar: "Encaminhar",
  ambigua: "Ambígua",
};

const fmtBRL = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ComercialPage() {
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [growth, setGrowth] = useState<GrowthData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/inbox").then((r) => r.json()).then((d) => setInbox(d.items ?? [])).catch(() => undefined);
    fetch("/api/deals").then((r) => r.json()).then((d) => setDeals(d.deals ?? [])).catch(() => undefined);
    fetch("/api/meetings").then((r) => r.json()).then((d) => setMeetings(d.meetings ?? [])).catch(() => undefined);
    fetch("/api/prospects?status=respondeu&limit=100")
      .then((r) => r.json())
      .then((d) => setProspects(d.prospects ?? []))
      .catch(() => undefined);
    fetch("/api/growth")
      .then((r) => r.json())
      .then(setGrowth)
      .catch(() => undefined);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function classifyAndOptout(item: InboxItem) {
    if (item.intent) return;
    const res = await fetch("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prospectId: item.prospect_id, channel: item.channel, body: item.body }),
    });
    if (res.ok) {
      setMsg("Resposta reclassificada. Se foi opt-out, o contato foi bloqueado automaticamente.");
      load();
    }
  }

  async function markInbox(id: string, status: string) {
    await fetch("/api/inbox", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    load();
  }

  async function createMeeting(prospectId: string) {
    const res = await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prospectId }),
    });
    if (res.ok) {
      setMsg("Reunião criada com briefing automático (contexto + histórico + pergunta sugerida).");
      load();
    }
  }

  async function createDeal(prospectId: string, companyName: string) {
    const valueStr = prompt(`Valor da proposta para ${companyName} (R$):`, "3000");
    if (valueStr === null) return;
    const valueCents = Math.round(parseFloat(valueStr.replace(/\./g, "").replace(",", ".")) * 100) || 0;
    const res = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prospectId, valueCents }),
    });
    if (res.ok) {
      setMsg("Proposta criada. Mova o estágio conforme avança.");
      load();
    }
  }

  async function moveDeal(id: string, stage: string) {
    await fetch("/api/deals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, stage }) });
    load();
  }

  async function saveMeetingField(id: string, field: string) {
    const value = prompt(` ${field === "summary" ? "Resumo" : field === "objections" ? "Objeções" : "Próximo passo"} da reunião:`);
    if (value === null) return;
    const patch: Record<string, string> = {};
    if (field === "summary") patch.summary = value;
    if (field === "objections") patch.objections = value;
    if (field === "nextStep") patch.nextStep = value;
    await fetch("/api/meetings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
    load();
  }

  async function setDeliveryStage(dealId: string, stage: string) {
    await fetch("/api/growth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-delivery", dealId, stage }),
    });
    load();
  }

  async function growthAction(payload: Record<string, unknown>) {
    await fetch("/api/growth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    load();
  }

  const sdrQueue = prospects.filter((p) => p.status === "respondeu");
  const newInbox = inbox.filter((i) => i.status === "novo");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-white">Comercial</h1>
        <p className="text-sm text-zinc-500">SDR (fila de respostas) → Reunião → Proposta → Venda → Entrega. Score e sugestões são assistivos; a decisão é sua.</p>
      </header>
      {msg && <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-200">{msg}</div>}

      {/* ── SDR: fila de respostas ── */}
      <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-100">Inbox · Respostas ({newInbox.length} novas)</h2>
        <div className="space-y-2">
          {inbox.slice(0, 12).map((i) => {
            const prospect = prospects.find((p) => p.id === i.prospect_id);
            return (
              <div key={i.id} className="rounded-lg bg-zinc-900/60 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-200">{prospect?.company_name ?? i.prospect_id.slice(0, 8)}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{i.channel}</span>
                  {i.intent && (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      i.intent === "opt_out" ? "bg-red-950 text-red-300"
                      : i.intent === "interesse" ? "bg-emerald-950 text-emerald-300"
                      : i.intent === "sem_interesse" ? "bg-amber-950 text-amber-300"
                      : "bg-sky-950 text-sky-300"}`}>
                      {INTENT_LABEL[i.intent] ?? i.intent}
                    </span>
                  )}
                  {Boolean(i.suggests_meeting) && <span className="rounded bg-indigo-950 px-1.5 py-0.5 text-[10px] text-indigo-300">sugere reunião</span>}
                  <span className="ml-auto text-zinc-600">{new Date(i.created_at).toLocaleDateString("pt-BR")}</span>
                </div>
                <p className="mt-1.5 text-zinc-400">{i.summary ?? i.body.slice(0, 200)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {!i.intent && <button onClick={() => void classifyAndOptout(i)} className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800">Classificar</button>}
                  {i.suggests_meeting ? (
                    <button onClick={() => void createMeeting(i.prospect_id)} className="rounded border border-indigo-800 px-2 py-1 text-[10px] text-indigo-300 hover:bg-indigo-950/40">Criar reunião + briefing</button>
                  ) : (
                    <button onClick={() => void createDeal(i.prospect_id, prospect?.company_name ?? "Lead")} className="rounded border border-emerald-800 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-950/40">Gerar proposta</button>
                  )}
                  {i.status === "novo" && <button onClick={() => void markInbox(i.id, "tratado")} className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800">Marcar tratado</button>}
                </div>
              </div>
            );
          })}
          {inbox.length === 0 && (
            <p className="py-6 text-center text-xs text-zinc-600">
              Sem respostas ainda. Registre respostas recebidas (WhatsApp/e-mail/Instagram) via POST /api/inbox — a classificação é automática.
            </p>
          )}
        </div>
      </section>

      {/* ── SDR: fila de leads que responderam ── */}
      <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-100">Fila SDR · Responderam ({sdrQueue.length})</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {sdrQueue.slice(0, 8).map((p) => (
            <div key={p.id} className="rounded-lg bg-zinc-900/60 p-3 text-xs">
              <p className="font-medium text-zinc-200">{p.company_name}</p>
              <p className="text-zinc-500">{p.niche ?? "—"} · {p.city ?? "?"}/{p.state ?? "?"} · {p.last_channel ?? "—"}</p>
              {p.notes && <p className="mt-1 line-clamp-2 text-zinc-600">{p.notes.slice(-160)}</p>}
              <div className="mt-2 flex gap-2">
                <button onClick={() => void createMeeting(p.id)} className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800">Briefing</button>
                <button onClick={() => void createDeal(p.id, p.company_name)} className="rounded border border-emerald-800 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-950/40">Proposta</button>
              </div>
            </div>
          ))}
          {sdrQueue.length === 0 && <p className="col-span-full py-6 text-center text-xs text-zinc-600">Nenhum lead respondeu ainda.</p>}
        </div>
      </section>

      {/* ── Reuniões ── */}
      <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-100">Reuniões ({meetings.length})</h2>
        <div className="space-y-2">
          {meetings.slice(0, 6).map((m) => {
            const prospect = prospects.find((p) => p.id === m.prospect_id);
            return (
              <details key={m.id} className="rounded-lg bg-zinc-900/60 p-3 text-xs">
                <summary className="cursor-pointer font-medium text-zinc-200">
                  {prospect?.company_name ?? m.prospect_id.slice(0, 8)} · {new Date(m.created_at).toLocaleDateString("pt-BR")}
                </summary>
                {m.brief && <pre className="mt-2 whitespace-pre-wrap rounded bg-zinc-950/70 p-2.5 text-[11px] text-zinc-400">{m.brief}</pre>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={() => void saveMeetingField(m.id, "summary")} className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800">Resumo {m.summary ? "✓" : ""}</button>
                  <button onClick={() => void saveMeetingField(m.id, "objections")} className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800">Objeções {m.objections ? "✓" : ""}</button>
                  <button onClick={() => void saveMeetingField(m.id, "nextStep")} className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800">Próximo passo {m.next_step ? "✓" : ""}</button>
                </div>
                {m.next_step && <p className="mt-1.5 text-emerald-300/80">→ {m.next_step}</p>}
              </details>
            );
          })}
          {meetings.length === 0 && <p className="py-4 text-center text-xs text-zinc-600">Nenhuma reunião. Crie a partir do inbox ou da fila SDR.</p>}
        </div>
      </section>

      {/* ── Propostas / Vendas ── */}
      <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-100">Propostas & Vendas ({deals.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-[10px] uppercase tracking-wide text-zinc-500">
                <th className="px-2 py-2">Proposta</th>
                <th className="px-2 py-2">Valor</th>
                <th className="px-2 py-2">Estágio</th>
                <th className="px-2 py-2">Mover para</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {deals.map((d) => (
                <tr key={d.id}>
                  <td className="px-2 py-2 font-medium text-zinc-300">{d.title}</td>
                  <td className="px-2 py-2 tabular-nums text-zinc-400">{fmtBRL(d.value_cents)}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      d.stage === "ganho" ? "bg-emerald-950 text-emerald-300"
                      : d.stage === "perdido" ? "bg-red-950 text-red-300"
                      : d.stage === "negociacao" ? "bg-amber-950 text-amber-300"
                      : "bg-sky-950 text-sky-300"}`}>{d.stage}</span>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={d.stage}
                      onChange={(e) => void moveDeal(d.id, e.target.value)}
                      className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-300"
                    >
                      {["proposta", "negociacao", "ganho", "perdido"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {deals.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-zinc-600">Nenhuma proposta criada.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Delivery (pipeline pós-venda, persistido) ── */}
      <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="mb-1 text-sm font-semibold text-zinc-100">Entrega (pós-venda)</h2>
        <p className="mb-3 text-[11px] text-zinc-600">VENDIDO → ONBOARDING → EM PRODUÇÃO → REVISÃO → PRONTO → ENTREGUE → RECORRÊNCIA</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {deals.filter((d) => d.stage === "ganho").map((d) => {
            const prospect = prospects.find((p) => p.id === d.prospect_id);
            const stage = growth?.delivery.find((x) => x.deal_id === d.id)?.stage ?? "VENDIDO";
            return (
              <div key={d.id} className="rounded-lg bg-zinc-900/60 p-3 text-xs">
                <p className="font-medium text-zinc-200">{prospect?.company_name ?? d.title}</p>
                <p className="text-zinc-500">{fmtBRL(d.value_cents)}</p>
                <select
                  value={stage}
                  onChange={(e) => void setDeliveryStage(d.id, e.target.value)}
                  className="mt-2 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300"
                >
                  {DELIVERY_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            );
          })}
          {deals.filter((d) => d.stage === "ganho").length === 0 && (
            <p className="col-span-full py-4 text-center text-xs text-zinc-600">Nenhuma venda marcada ainda.</p>
          )}
        </div>
      </section>

      {/* ── Pós-venda: referral/proof + expansion ── */}
      <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="mb-1 text-sm font-semibold text-zinc-100">Pós-venda · Prova & Expansão</h2>
        <p className="mb-3 text-[11px] text-zinc-600">Expansão só existe aqui com sinal real registrado — a IA nunca inventa oportunidade.</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Indicações & Provas</h3>
            <div className="space-y-1.5">
              {growth?.referrals.slice(0, 6).map((r) => (
                <div key={r.id} className="rounded-lg bg-zinc-900/60 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-300">{r.company_name}</span>
                    <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{REFERRAL_LABEL[r.kind] ?? r.kind}</span>
                    <span className={`rounded px-1.5 text-[10px] ${r.status === "publicado" ? "bg-emerald-950 text-emerald-300" : r.status === "recusado" ? "bg-red-950 text-red-300" : "bg-amber-950 text-amber-300"}`}>{r.status}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {r.status === "solicitado" && (
                      <>
                        <button onClick={() => void growthAction({ action: "update-referral", id: r.id, status: "recebido" })} className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800">recebido</button>
                        <button onClick={() => void growthAction({ action: "update-referral", id: r.id, status: "recusado" })} className="rounded border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-600 hover:text-red-400">recusado</button>
                      </>
                    )}
                    {r.status === "recebido" && r.kind === "indicacao" && (
                      <button
                        onClick={() => {
                          const name = prompt("Nome da empresa indicada:");
                          if (name) void growthAction({ action: "convert-referral", id: r.id, companyName: name });
                        }}
                        className="rounded border border-emerald-800 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-950/40"
                      >
                        → virar contato na base
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {(growth?.referrals.length ?? 0) === 0 && <p className="py-3 text-center text-[11px] text-zinc-600">Nenhuma solicitação ainda — peça após entrega.</p>}
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Oportunidades de expansão (sinais reais)</h3>
            <div className="space-y-1.5">
              {growth?.expansions.slice(0, 6).map((e) => (
                <div key={e.id} className="rounded-lg bg-zinc-900/60 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-300">{e.company_name}</span>
                    <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400">{EXPANSION_LABEL[e.signal] ?? e.signal}</span>
                    <span className={`ml-auto rounded px-1.5 text-[10px] ${e.status === "aceita" ? "bg-emerald-950 text-emerald-300" : e.status === "descartada" ? "bg-zinc-800 text-zinc-500" : "bg-sky-950 text-sky-300"}`}>{e.status}</span>
                  </div>
                  <p className="mt-1 text-zinc-500">{e.detail}</p>
                  {e.status === "detectada" && (
                    <div className="mt-1 flex gap-1.5">
                      <button onClick={() => void growthAction({ action: "set-expansion-status", id: e.id, status: "oferecida" })} className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800">oferecida</button>
                      <button onClick={() => void growthAction({ action: "set-expansion-status", id: e.id, status: "aceita" })} className="rounded border border-emerald-800 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-950/40">aceita</button>
                      <button onClick={() => void growthAction({ action: "set-expansion-status", id: e.id, status: "descartada" })} className="rounded border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-600 hover:text-red-400">descartar</button>
                    </div>
                  )}
                </div>
              ))}
              {(growth?.expansions.length ?? 0) === 0 && <p className="py-3 text-center text-[11px] text-zinc-600">Nenhum sinal registrado. Registre durante reuniões/entregas.</p>}
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-orange-300 hover:underline">+ registrar sinal de expansão</summary>
              <div className="mt-2 space-y-1.5">
                {prospects.slice(0, 20).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      const signal = prompt(`Sinal para ${p.company_name} (${Object.keys(EXPANSION_LABEL).join(" | ")}):`);
                      if (!signal || !EXPANSION_LABEL[signal]) return alert("Sinal inválido");
                      const detail = prompt("Detalhe real observado (obrigatório):");
                      if (!detail) return;
                      void growthAction({ action: "add-expansion", prospectId: p.id, signal, detail });
                    }}
                    className="block w-full rounded bg-zinc-900/60 px-2 py-1 text-left text-[11px] text-zinc-400 hover:bg-zinc-900"
                  >
                    {p.company_name}
                  </button>
                ))}
              </div>
            </details>
          </div>
        </div>
      </section>
    </div>
  );
}
