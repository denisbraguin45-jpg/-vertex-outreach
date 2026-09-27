"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface Prospect {
  id: string;
  company_name: string;
  niche: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  instagram: string | null;
  website: string | null;
  status: string;
  last_contacted_at: string | null;
}

interface Counters {
  total: number;
  byStatus: Record<string, number>;
  withWhatsapp: number;
  withEmail: number;
  withInstagram: number;
  withSite: number;
}

const STATUS_LABEL: Record<string, string> = {
  nao_contatado: "Não contatado",
  contatado: "Contatado",
  respondeu: "Respondeu",
  interessado: "Interessado",
  sem_interesse: "Sem interesse",
  opt_out: "Opt-out",
};

const STATUS_STYLE: Record<string, string> = {
  nao_contatado: "bg-zinc-800 text-zinc-400",
  contatado: "bg-sky-950 text-sky-300",
  respondeu: "bg-indigo-950 text-indigo-300",
  interessado: "bg-emerald-950 text-emerald-300",
  sem_interesse: "bg-amber-950 text-amber-300",
  opt_out: "bg-red-950 text-red-300",
};

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: "nao_contatado", label: "Não contatado" },
  { key: "contatado", label: "Contatado" },
  { key: "respondeu", label: "Respondeu" },
  { key: "interessado", label: "Interessado" },
  { key: "sem_interesse", label: "Sem interesse" },
  { key: "opt_out", label: "Opt-out" },
];

const CHANNEL_FILTERS: Array<{ key: string; label: string }> = [
  { key: "hasWhatsapp", label: "Possui WhatsApp" },
  { key: "hasEmail", label: "Possui E-mail" },
  { key: "hasInstagram", label: "Possui Instagram" },
  { key: "hasSite", label: "Possui Site" },
  { key: "noSite", label: "Sem Site" },
];

const EMPTY_FILTERS = {
  search: "",
  niche: "",
  status: "",
  hasWhatsapp: false,
  hasEmail: false,
  hasInstagram: false,
  hasSite: false,
  noSite: false,
};

type Filters = typeof EMPTY_FILTERS;

export default function ContatosPage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [counters, setCounters] = useState<Counters | null>(null);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState(0);

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    if (filters.search) sp.set("search", filters.search);
    if (filters.niche) sp.set("niche", filters.niche);
    if (filters.status) sp.set("status", filters.status);
    if (filters.hasWhatsapp) sp.set("hasWhatsapp", "1");
    if (filters.hasEmail) sp.set("hasEmail", "1");
    if (filters.hasInstagram) sp.set("hasInstagram", "1");
    if (filters.hasSite) sp.set("hasSite", "1");
    if (filters.noSite) sp.set("noSite", "1");
    sp.set("limit", "500");
    return sp.toString();
  }, [filters]);

  const load = useCallback(() => {
    fetch(`/api/prospects?${query}`)
      .then((r) => r.json())
      .then((d) => {
        setProspects(d.prospects ?? []);
        setCounters(d.counters ?? null);
        setTotal(d.total ?? 0);
      })
      .catch(() => undefined);
  }, [query]);

  useEffect(() => {
    load();
  }, [load, load]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allVisibleSelected = prospects.length > 0 && prospects.every((p) => selected.has(p.id));

  function toggleAll() {
    setSelected((s) => {
      if (allVisibleSelected) return new Set();
      return new Set(prospects.map((p) => p.id));
    });
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Excluir ${selected.size} contato(s)? Esta ação não pode ser desfeita.`)) return;
    await fetch("/api/prospects", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    });
    setSelected(new Set());
    load();
  }

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const anyFilter = JSON.stringify(filters) !== JSON.stringify({ ...EMPTY_FILTERS });

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Base de Contatos</h1>
          <p className="text-sm text-zinc-500">
            {counters ? `${counters.total.toLocaleString("pt-BR")} contatos · ${counters.withWhatsapp} com WhatsApp · ${counters.withEmail} com e-mail · ${counters.withInstagram} com Instagram` : "Carregando…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/prospects/export?${query}`}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            Exportar CSV
          </a>
          <button
            onClick={deleteSelected}
            disabled={selected.size === 0}
            className="rounded-lg border border-red-900/60 px-3 py-2 text-xs font-medium text-red-300 transition hover:bg-red-950/40 disabled:opacity-30"
          >
            Excluir selecionados ({selected.size})
          </button>
          <Link
            href={`/disparo${selected.size ? `?ids=${[...selected].join(",")}` : ""}`}
            className="rounded-lg bg-orange-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-orange-400"
          >
            Compor disparo →
          </Link>
        </div>
      </header>

      <div className="space-y-2 rounded-xl border border-zinc-800 bg-[#0D1117] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={filters.search}
            onChange={(e) => setFilter("search", e.target.value)}
            placeholder="Buscar empresa, telefone, e-mail, @…"
            className="min-w-[240px] flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-orange-500/40"
          />
          {CHANNEL_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key as keyof Filters, !filters[f.key as keyof Filters] as never)}
              className={`rounded-full px-3 py-1.5 text-xs transition ${
                filters[f.key as keyof Filters]
                  ? "bg-orange-500/90 font-medium text-zinc-950"
                  : "border border-zinc-800 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter("status", filters.status === f.key ? "" : f.key)}
              className={`rounded-full px-3 py-1.5 text-xs transition ${
                filters.status === f.key
                  ? "bg-zinc-200 font-medium text-zinc-900"
                  : "border border-zinc-800 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {f.label}{counters ? ` (${counters.byStatus[f.key] ?? 0})` : ""}
            </button>
          ))}
          {anyFilter && (
            <button
              onClick={() => setFilters({ ...EMPTY_FILTERS })}
              className="rounded-full px-3 py-1.5 text-xs text-zinc-500 underline hover:text-zinc-300"
            >
              limpar filtros
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-[#0D1117]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-3">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} className="accent-orange-500" />
              </th>
              <th className="px-3 py-3">Empresa</th>
              <th className="px-3 py-3">Nicho</th>
              <th className="px-3 py-3">Cidade</th>
              <th className="px-3 py-3">Telefone</th>
              <th className="px-3 py-3">WhatsApp</th>
              <th className="px-3 py-3">E-mail</th>
              <th className="px-3 py-3">Instagram</th>
              <th className="px-3 py-3">Site</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Último contato</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {prospects.map((p) => (
              <tr key={p.id} className="transition hover:bg-zinc-900/40">
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="accent-orange-500" />
                </td>
                <td className="px-3 py-2">
                  <a
                    href={p.website ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-zinc-200 hover:text-orange-300"
                  >
                    {p.company_name}
                  </a>
                  {p.state && <span className="ml-1 text-[11px] text-zinc-600">{p.state}</span>}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-400">{p.niche ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-zinc-400">{p.city ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-zinc-300">{p.phone ?? "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {p.whatsapp ? (
                    <a href={`https://wa.me/${p.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline">
                      {p.whatsapp}
                    </a>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {p.email ? (
                    <a href={`mailto:${p.email}`} className="text-sky-300 hover:underline">{p.email}</a>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {p.instagram ? (
                    <a href={`https://instagram.com/${p.instagram.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="text-pink-300 hover:underline">
                      {p.instagram}
                    </a>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-400">{p.website ? "✓" : "—"}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[p.status] ?? "bg-zinc-800 text-zinc-400"}`}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500">
                  {p.last_contacted_at ? new Date(p.last_contacted_at).toLocaleDateString("pt-BR") : "—"}
                </td>
              </tr>
            ))}
            {prospects.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-xs text-zinc-600">
                  {anyFilter ? "Nenhum contato com esses filtros." : "Base vazia — rode uma coleta na aba Prospecção."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-zinc-600">
        Exibindo {prospects.length} de {total.toLocaleString("pt-BR")} contato(s) com os filtros atuais (limite 500 por tela).
      </p>
    </div>
  );
}
