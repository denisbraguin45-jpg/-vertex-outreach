"use client";

import { useEffect, useState } from "react";

interface Lead {
  id: string;
  full_name: string;
  instagram_handle: string;
  channel: string;
  notes: string | null;
}

interface Job {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export default function ExcecoesPage() {
  const [review, setReview] = useState<Lead[]>([]);
  const [deadJobs, setDeadJobs] = useState<Job[]>([]);
  const [errors, setErrors] = useState<Array<{ id: string; kind: string; detail_json: string; created_at: string }>>([]);

  useEffect(() => {
    const load = () => {
      fetch("/api/leads?channel=human_review_required&limit=100")
        .then((r) => r.json())
        .then((d) => setReview(d.leads))
        .catch(() => undefined);
      fetch("/api/jobs?status=dead")
        .then((r) => r.json())
        .then((d) => setDeadJobs(d.jobs))
        .catch(() => undefined);
      fetch("/api/events?level=error")
        .then((r) => r.json())
        .then((d) => setErrors(d.events))
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-white">Fila de exceções</h1>
        <p className="text-sm text-zinc-500">Tudo que a IA decidiu não resolver sozinha — revisão humana.</p>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-[#0D1117]">
        <h2 className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-200">
          Revisão humana ({review.length})
        </h2>
        <div className="divide-y divide-zinc-800/70">
          {review.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-200">{l.full_name} <span className="text-zinc-500">@{l.instagram_handle}</span></p>
                {l.notes && <p className="truncate text-[11px] text-zinc-500">{l.notes.split("\n").pop()}</p>}
              </div>
              <a href={`https://instagram.com/${l.instagram_handle}`} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline">
                abrir no Instagram
              </a>
            </div>
          ))}
          {review.length === 0 && <p className="px-4 py-8 text-center text-xs text-zinc-600">Nada aguardando revisão. ✅</p>}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-[#0D1117]">
        <h2 className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-200">
          Jobs mortos ({deadJobs.length})
        </h2>
        <div className="divide-y divide-zinc-800/70">
          {deadJobs.map((j) => (
            <div key={j.id} className="px-4 py-2.5 text-xs">
              <p className="font-medium text-zinc-300">{j.kind} · {j.attempts} tentativas</p>
              <p className="text-red-400/80">{j.last_error}</p>
            </div>
          ))}
          {deadJobs.length === 0 && <p className="px-4 py-8 text-center text-xs text-zinc-600">Nenhum job esgotado.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-[#0D1117]">
        <h2 className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-200">
          Erros recentes ({errors.length})
        </h2>
        <div className="divide-y divide-zinc-800/70">
          {errors.map((e) => (
            <div key={e.id} className="px-4 py-2.5 text-xs">
              <p className="font-medium text-zinc-300">{e.kind}</p>
              <p className="text-zinc-500">{e.detail_json.slice(0, 200)}</p>
              <p className="text-zinc-600">{new Date(e.created_at).toLocaleString("pt-BR")}</p>
            </div>
          ))}
          {errors.length === 0 && <p className="px-4 py-8 text-center text-xs text-zinc-600">Sem erros.</p>}
        </div>
      </section>
    </div>
  );
}
