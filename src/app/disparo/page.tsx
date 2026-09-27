"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Prospect {
  id: string;
  company_name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  instagram: string | null;
  status: string;
}

interface Template {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
}

interface RecentEntry {
  id: string;
  company_name: string;
  channel: string;
  body: string;
  status: string;
  created_at: string;
}

type Channel = "whatsapp" | "email" | "instagram";

const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  email: "E-mail",
  instagram: "Instagram",
};

export default function DisparoPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Carregando…</p>}>
      <DisparoInner />
    </Suspense>
  );
}

function fillPlaceholders(text: string, p: Prospect): string {
  return text
    .replaceAll("{{empresa}}", p.company_name)
    .replaceAll("{{nome}}", p.company_name);
}

function DisparoInner() {
  const searchParams = useSearchParams();
  const preselected = useMemo(
    () => new Set((searchParams.get("ids") ?? "").split(",").filter(Boolean)),
    [searchParams],
  );

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [selected, setSelected] = useState<Set<string>>(preselected);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    fetch("/api/templates").then((r) => r.json()).then((d) => setTemplates(d.templates ?? [])).catch(() => undefined);
    fetch("/api/outreach").then((r) => r.json()).then((d) => setRecent(d.recent ?? [])).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Carrega prospects selecionados (da Base) ou todos com o canal escolhido
  useEffect(() => {
    const params = new URLSearchParams();
    if (channel === "whatsapp") params.set("hasWhatsapp", "1");
    if (channel === "email") params.set("hasEmail", "1");
    if (channel === "instagram") params.set("hasInstagram", "1");
    params.set("limit", "500");
    fetch(`/api/prospects?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setProspects(d.prospects ?? []))
      .catch(() => undefined);
  }, [channel]);

  useEffect(() => {
    const t = templates.find((x) => x.id === templateId);
    if (t) {
      setSubject(t.subject ?? "");
      setBody(t.body);
    }
  }, [templateId, templates]);

  const selectedProspects = useMemo(
    () => prospects.filter((p) => selected.has(p.id) && p.status !== "opt_out"),
    [prospects, selected],
  );

  function channelOf(p: Prospect): string | null {
    if (channel === "whatsapp") return p.whatsapp;
    if (channel === "email") return p.email;
    return p.instagram;
  }

  function openLink(p: Prospect): string | null {
    const text = encodeURIComponent(fillPlaceholders(body, p));
    const contact = channelOf(p);
    if (!contact) return null;
    if (channel === "whatsapp") return `https://wa.me/${contact.replace(/\D/g, "")}?text=${text}`;
    if (channel === "email") {
      const s = encodeURIComponent(fillPlaceholders(subject, p));
      return `mailto:${contact}?subject=${s}&body=${text}`;
    }
    return `https://instagram.com/${contact.replace(/^@/, "")}`;
  }

  async function recordSend(p: Prospect, failed: boolean) {
    const res = await fetch("/api/outreach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prospectId: p.id,
        channel,
        templateId: templateId || null,
        subject: channel === "email" ? fillPlaceholders(subject, p) : null,
        body: fillPlaceholders(body, p),
        failed,
      }),
    });
    if (res.ok && !failed) setSentIds((s) => new Set(s).add(p.id));
  }

  async function recordAll() {
    if (!body.trim()) {
      setMsg("Escreva a mensagem antes de registrar.");
      return;
    }
    if (selectedProspects.length === 0) {
      setMsg("Selecione pelo menos um contato (sem opt-out).");
      return;
    }
    let ok = 0;
    for (const p of selectedProspects) {
      const link = openLink(p);
      if (link) window.open(link, "_blank");
      await recordSend(p, !link);
      if (link) ok += 1;
    }
    setMsg(`${ok} aba(s) aberta(s) e ${selectedProspects.length} disparo(s) registrado(s). Revise cada aba antes de enviar.`);
    load();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-white">Disparo</h1>
        <p className="text-sm text-zinc-500">
          Compose manual: escreva uma vez, o sistema prepara a mensagem para cada contato. O clique final de envio é sempre seu.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* ── Compose ── */}
        <section className="space-y-3 rounded-xl border border-zinc-800 bg-[#0D1117] p-4 lg:col-span-3">
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-1 text-xs">
            {(["whatsapp", "email", "instagram"] as Channel[]).map((c) => (
              <button
                key={c}
                onClick={() => setChannel(c)}
                className={`flex-1 rounded px-3 py-1.5 ${channel === c ? "bg-zinc-800 font-medium text-white" : "text-zinc-500"}`}
              >
                {CHANNEL_LABEL[c]}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="text-zinc-500">Template (opcional)</span>
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
              >
                <option value="">— escrever do zero —</option>
                {templates.filter((t) => t.channel === channel || t.channel === "universal").map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-zinc-500">Salvar mensagem atual como template</span>
              <button
                onClick={async () => {
                  const name = prompt("Nome do template:");
                  if (!name || !body.trim()) return;
                  await fetch("/api/templates", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, channel, subject, body }),
                  });
                  load();
                }}
                className="w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
              >
                Salvar template
              </button>
            </label>
          </div>

          {channel === "email" && (
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Assunto (e-mail)"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600"
            />
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            placeholder={`Olá {{empresa}}, tudo bem? …`}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600"
          />
          <p className="text-[11px] text-zinc-600">
            Variáveis: <code className="text-zinc-400">{"{{empresa}}"}</code> substituída pelo nome do contato.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={recordAll}
              className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-orange-400"
            >
              Abrir {selectedProspects.length || ""} aba(s) e registrar
            </button>
            <span className="text-[11px] text-zinc-600">
              O envio final acontece na aba do WhatsApp/e-mail/Instagram — nada é enviado automaticamente.
            </span>
          </div>
          {msg && <p className="text-xs text-amber-300">{msg}</p>}
        </section>

        {/* ── Seleção de contatos ── */}
        <section className="space-y-2 rounded-xl border border-zinc-800 bg-[#0D1117] p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">Contatos ({selectedProspects.length} selecionados)</h2>
            <button
              onClick={() => setSelected(new Set(prospects.map((p) => p.id)))}
              className="text-[11px] text-zinc-500 underline hover:text-zinc-300"
            >
              marcar todos
            </button>
          </div>
          <div className="max-h-[420px] space-y-1 overflow-y-auto">
            {prospects.map((p) => {
              const has = Boolean(channelOf(p));
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                    has ? "cursor-pointer hover:bg-zinc-900" : "opacity-40"
                  } ${selected.has(p.id) ? "bg-zinc-900/80" : ""}`}
                >
                  <input
                    type="checkbox"
                    disabled={!has || p.status === "opt_out"}
                    checked={selected.has(p.id)}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(p.id)) n.delete(p.id);
                        else n.add(p.id);
                        return n;
                      })
                    }
                    className="accent-orange-500"
                  />
                  <span className="flex-1 truncate text-zinc-300">{p.company_name}</span>
                  <span className="truncate text-[11px] text-zinc-600">{channelOf(p) ?? "sem canal"}</span>
                  {sentIds.has(p.id) && <span className="text-emerald-400">✓</span>}
                </label>
              );
            })}
            {prospects.length === 0 && (
              <p className="py-8 text-center text-xs text-zinc-600">
                Nenhum contato com este canal. Colete mais na Prospecção.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* ── Acompanhar: últimos disparos ── */}
      <section className="rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
        <h2 className="mb-2 text-sm font-semibold text-zinc-100">Últimos disparos</h2>
        <div className="space-y-1">
          {recent.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg bg-zinc-900/50 px-3 py-1.5 text-xs">
              <span className="w-20 shrink-0 text-zinc-500">{new Date(r.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              <span className="w-40 shrink-0 truncate font-medium text-zinc-300">{r.company_name}</span>
              <span className="w-20 shrink-0 rounded bg-zinc-800 px-1.5 text-center text-[11px] text-zinc-400">{r.channel}</span>
              <span className={`w-16 shrink-0 text-[11px] ${r.status === "falha" ? "text-red-400" : "text-emerald-400"}`}>{r.status}</span>
              <span className="flex-1 truncate text-zinc-600">{r.body}</span>
            </div>
          ))}
          {recent.length === 0 && <p className="py-4 text-center text-xs text-zinc-600">Nenhum disparo registrado ainda.</p>}
        </div>
      </section>
    </div>
  );
}
