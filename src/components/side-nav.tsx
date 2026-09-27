"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "Visão Geral" },
  { href: "/prospeccao", label: "Prospecção" },
  { href: "/contatos", label: "Base de Contatos" },
  { href: "/disparo", label: "Disparo" },
  { href: "/comercial", label: "Comercial" },
  { href: "/marketing", label: "Marketing OS" },
  { href: "/ecom-stock", label: "ECOM Stock" },
  { href: "/leads", label: "Leads Instagram" },
  { href: "/conversas", label: "Conversas" },
  { href: "/excecoes", label: "Exceções" },
  { href: "/experimentos", label: "Experimentos" },
  { href: "/custos", label: "Custos de IA" },
  { href: "/configuracoes", label: "Configurações" },
];

export function SideNav() {
  const pathname = usePathname();
  const [status, setStatus] = useState<{ paused: boolean; reason: string; dryRun: boolean; queue: number } | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/status")
        .then((r) => r.json())
        .then(setStatus)
        .catch(() => undefined);
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  async function togglePause() {
    await fetch("/api/pause", { method: "POST" });
    const r = await fetch("/api/status").then((x) => x.json());
    setStatus(r);
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-zinc-800/80 bg-[#0D1117] px-4 py-5 md:flex">
      <div className="mb-6">
        <p className="text-sm font-bold tracking-tight text-zinc-100">
          VERTEX <span className="text-orange-400">OUTREACH</span>
        </p>
        <p className="text-[11px] text-zinc-500">Prospecção autônoma · Instagram</p>
      </div>

      <nav className="flex-1 space-y-0.5">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm transition ${
                active ? "bg-zinc-800/80 font-medium text-white" : "text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-zinc-800/80 pt-3">
        <a href="https://www.instagram.com/" target="_blank" rel="noreferrer" className="block rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300">
          ↗ Instagram
        </a>
        <a href="https://wa.me/" target="_blank" rel="noreferrer" className="block rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300">
          ↗ WhatsApp
        </a>
        {status && (
          <>
            <div className="flex items-center gap-2 px-3 text-[11px]">
              <span className={`h-2 w-2 rounded-full ${status.paused ? "bg-red-500" : "bg-emerald-500"}`} />
              <span className="text-zinc-400">{status.paused ? "Pausado" : "Operando"}</span>
              {status.dryRun && <span className="rounded bg-amber-900/50 px-1 text-amber-400">DRY-RUN</span>}
            </div>
            {status.paused && status.reason && (
              <p className="px-3 text-[11px] leading-relaxed text-red-400/80">{status.reason}</p>
            )}
            <button
              onClick={togglePause}
              className="w-full rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
            >
              {status.paused ? "Retomar operação" : "Pausar tudo"}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
