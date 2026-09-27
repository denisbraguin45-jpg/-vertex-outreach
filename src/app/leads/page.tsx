"use client";

import { useEffect, useMemo, useState } from "react";

interface Lead {
  id: string;
  funnel: "clients" | "affiliates";
  instagram_handle: string;
  full_name: string;
  profile_type: string;
  niche: string | null;
  score: number;
  priority: number;
  pipeline: string;
  channel: string;
  followers: number;
  notes: string | null;
}

const PIPELINES: Record<string, string> = {
  discovered: "Descoberto", qualified: "Qualificado", contacted: "Abordado", replied: "Respondeu",
  interested: "Interessado", whatsapp_handoff: "→ WhatsApp", registered: "Cadastrado",
  active_customer: "Cliente ativo", joined_affiliate_group: "Entrou no grupo",
  active_affiliate: "Afiliado ativo", generated_customer: "Gerou cliente", closed: "Encerrado",
};

const CHANNELS: Record<string, string> = {
  browser_contact_pending: "1º contato pendente",
  browser_contact_sent: "DM enviada",
  waiting_inbound_reply: "Aguardando resposta",
  api_eligible: "API elegível",
  api_active: "Conversa pela API",
  api_window_closed: "Janela 24h fechada",
  human_review_required: "Revisão humana",
  do_not_contact: "Não contactar",
  blocked: "Bloqueado",
  completed: "Concluído",
};

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [funnel, setFunnel] = useState<"clients" | "affiliates">("clients");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const load = () =>
      fetch(`/api/leads?funnel=${funnel}&limit=200`)
        .then((r) => r.json())
        .then((d) => setLeads(d.leads))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [funnel]);

  const filtered = useMemo(
    () => leads.filter((l) => (search ? (l.full_name + l.instagram_handle).toLowerCase().includes(search.toLowerCase()) : true)),
    [leads, search],
  );

  async function dnc(id: string) {
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doNotContact: true, reason: "marcado pelo operador" }),
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-white">Leads</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-zinc-800 bg-[#0D1117] p-1 text-xs">
            <button
              className={`rounded px-3 py-1.5 ${funnel === "clients" ? "bg-zinc-800 font-medium text-white" : "text-zinc-500"}`}
              onClick={() => setFunnel("clients")}
            >
              Clientes
            </button>
            <button
              className={`rounded px-3 py-1.5 ${funnel === "affiliates" ? "bg-zinc-800 font-medium text-white" : "text-zinc-500"}`}
              onClick={() => setFunnel("affiliates")}
            >
              Afiliados
            </button>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nome ou @…"
            className="rounded-lg border border-zinc-800 bg-[#0D1117] px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-orange-500/40"
          />
        </div>
      </header>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-[#0D1117]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Etapa</th>
              <th className="px-4 py-3">Canal</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {filtered.map((l) => (
              <tr key={l.id} className="transition hover:bg-zinc-900/40">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-zinc-200">{l.full_name}</p>
                  <p className="text-[11px] text-zinc-500">@{l.instagram_handle} · {l.followers.toLocaleString("pt-BR")} seguidores</p>
                </td>
                <td className="px-4 py-2.5 text-xs text-zinc-400">{l.profile_type}{l.niche ? ` · ${l.niche}` : ""}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                    l.score >= 70 ? "bg-emerald-950 text-emerald-300" : l.score >= 45 ? "bg-amber-950 text-amber-300" : "bg-zinc-800 text-zinc-400"
                  }`}>
                    {l.score}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-zinc-300">{PIPELINES[l.pipeline] ?? l.pipeline}</td>
                <td className="px-4 py-2.5 text-xs text-zinc-400">{CHANNELS[l.channel] ?? l.channel}</td>
                <td className="px-4 py-2.5 text-right">
                  {l.channel !== "do_not_contact" && (
                    <button onClick={() => void dnc(l.id)} className="text-[11px] text-zinc-600 hover:text-red-400">
                      não contactar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-zinc-600">
                  Nenhum lead neste funil ainda. O worker cria a descoberta automaticamente a cada 6h.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
