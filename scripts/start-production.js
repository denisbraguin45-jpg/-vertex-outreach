#!/usr/bin/env node
// ─── Production entrypoint (Render) ──────────────────────────────────────────
// Painel (Next.js standalone/next start) + worker como processos irmãos,
// compartilhando o SQLite em /data (WAL). Se o worker morrer, é reiniciado
// com backoff. Se o painel morrer, o Render reinicia o serviço inteiro.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.PORT || 3300;
const DATA_DIR = process.env.DATA_DIR || "/data";
const ROOT = process.cwd();

// Disco persistente precisa existir antes do SQLite abrir
if (process.env.DATABASE_URL?.startsWith("/data") && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let shuttingDown = false;

const NODE = process.execPath; // evita shim .cmd do npx no Windows
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const TSX_BIN = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

function launch(name, args, env = {}) {
  const child = spawn(NODE, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`[supervisor] ${name} saiu (code=${code} signal=${signal}) — reiniciando em 5s`);
    setTimeout(() => launch(name, args, env), 5_000);
  });
  return child;
}

// ── 1. Painel Next.js (build de produção) ────────────────────────────────────
launch("painel", [NEXT_BIN, "start", "-p", String(PORT), "-H", "0.0.0.0"]);

// ── 2. Worker de prospecção/outreach ─────────────────────────────────────────
launch("worker", [TSX_BIN, "src/worker/index.ts"]);

// ── 3. Encerramento limpo (SIGTERM do Render) ────────────────────────────────
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[supervisor] ${signal} recebido — encerrando processos`);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(`[supervisor] painel na porta ${PORT} + worker ativos (data: ${DATA_DIR})`);
