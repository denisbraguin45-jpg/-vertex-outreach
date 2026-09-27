"use client";

import { useEffect, useState } from "react";

interface Message {
  id: string;
  direction: "outbound" | "inbound";
  channel: string;
  body: string;
  variant: string | null;
  intent: string | null;
  created_at: string;
}

interface LeadLite {
  id: string;
  full_name: string;
  instagram_handle: string;
  channel: string;
}

export default function ConversasPage() {
  const [leads, setLeads] = useState<LeadLite[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    fetch("/api/leads?limit=100")
      .then((r) => r.json())
      .then((d) => setLeads(d.leads))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const load = () =>
      fetch(`/api/leads/${selected}`)
        .then((r) => r.json())
        .then((d) => setMessages(d.messages))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [selected]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-xl font-semibold text-white">Conversas</h1>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="max-h-[70vh] space-y-1 overflow-y-auto rounded-xl border border-zinc-800 bg-[#0D1117] p-2">
          {leads.map((l) => (
            <button
              key={l.id}
              onClick={() => setSelected(l.id)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                selected === l.id ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              <p className="truncate font-medium">{l.full_name}</p>
              <p className="truncate text-[11px] text-zinc-600">@{l.instagram_handle}</p>
            </button>
          ))}
          {leads.length === 0 && <p className="px-3 py-6 text-center text-xs text-zinc-600">Nenhum lead.</p>}
        </div>

        <div className="max-h-[70vh] space-y-2 overflow-y-auto rounded-xl border border-zinc-800 bg-[#0D1117] p-4">
          {!selected && <p className="py-10 text-center text-xs text-zinc-600">Selecione um lead para ver a conversa completa e auditável.</p>}
          {selected && messages.length === 0 && <p className="py-10 text-center text-xs text-zinc-600">Nenhuma mensagem registrada.</p>}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                  m.direction === "outbound"
                    ? m.channel === "browser"
                      ? "bg-orange-950/60 text-orange-100"
                      : "bg-sky-950/60 text-sky-100"
                    : "bg-zinc-800/80 text-zinc-200"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="mt-1 text-right text-[10px] text-zinc-500">
                  {m.channel === "browser" ? "navegador" : m.channel === "api" ? "API oficial" : "sistema"}
                  {m.variant ? ` · ${m.variant}` : ""}
                  {m.intent ? ` · ${m.intent}` : ""} · {new Date(m.created_at).toLocaleTimeString("pt-BR")}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
