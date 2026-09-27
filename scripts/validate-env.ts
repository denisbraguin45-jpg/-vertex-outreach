// ─── Credential validator: checks each .env value live and safely ──────────
// Run: npm run check-env

import "dotenv/config";

interface Check {
  key: string;
  label: string;
  ok: (v: string) => boolean;
  live?: (v: string) => Promise<{ ok: boolean; detail: string }>;
}

const checks: Check[] = [
  {
    key: "OPENAI_API_KEY",
    label: "LLM API key (Gemini/OpenAI)",
    ok: (v) => v.length > 20 && !v.startsWith("COLE_"),
    live: async (v) => {
      const base = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
      const isGemini = base.includes("generativelanguage");
      try {
        // OpenAI-compatible probe: list models on the configured provider
        const url = isGemini
          ? `${base}models`
          : `${base.replace(/\/$/, "")}/models`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${v}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return { ok: true, detail: `chave válida (${isGemini ? "Gemini" : "OpenAI"})` };
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return { ok: false, detail: `HTTP ${res.status}: ${body.error?.message ?? "erro"}` };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    key: "INSTAGRAM_PAGE_ACCESS_TOKEN",
    label: "Instagram Page Access Token",
    ok: (v) => v.length > 20 && !v.startsWith("COLE_"),
    live: async (v) => {
      const igId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "";
      if (!igId || igId.startsWith("COLE_")) {
        return { ok: false, detail: "informe INSTAGRAM_BUSINESS_ACCOUNT_ID para validar o token" };
      }
      try {
        const res = await fetch(
          `https://graph.instagram.com/v21.0/${igId}?fields=username&access_token=${encodeURIComponent(v)}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        const body = (await res.json().catch(() => ({}))) as {
          username?: string;
          error?: { message?: string; code?: number };
        };
        if (res.ok && body.username) return { ok: true, detail: `token válido · @${body.username}` };
        return { ok: false, detail: body.error?.message ?? `HTTP ${res.status}` };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    key: "INSTAGRAM_BUSINESS_ACCOUNT_ID",
    label: "IG Business Account ID",
    ok: (v) => /^\d{5,}$/.test(v),
  },
  {
    key: "INSTAGRAM_APP_SECRET",
    label: "Meta App Secret",
    ok: (v) => /^[a-f0-9]{32}$/i.test(v),
  },
  {
    key: "INSTAGRAM_WEBHOOK_VERIFY_TOKEN",
    label: "Webhook Verify Token",
    ok: (v) => v.length >= 16 && !v.startsWith("INVENTE_"),
  },
];

async function main() {
  console.log("Validação de credenciais — Vertex Outreach\n");
  let liveCount = 0;
  for (const c of checks) {
    const v = process.env[c.key] ?? "";
    const formatOk = c.ok(v);
    let status: string;
    if (!formatOk) {
      status = "❌ formato/placeholder inválido — preencha no .env";
    } else if (c.live) {
      const res = await c.live(v);
      status = res.ok ? `✅ ${res.detail}` : `⚠️  formato ok, mas falhou ao validar: ${res.detail}`;
      if (res.ok) liveCount++;
    } else {
      status = "✅ formato ok (validação ao vivo não aplicável)";
      liveCount++;
    }
    console.log(`  ${c.label.padEnd(30)} ${status}`);
  }

  console.log("\nModo atual:");
  console.log(`  OUTREACH_DRY_RUN=${process.env.OUTREACH_DRY_RUN ?? "true"}  (true = nada é enviado de verdade)`);
  console.log(`  OUTREACH_AI_SIMULATE_API=${process.env.OUTREACH_AI_SIMULATE_API ?? "true"}  (true = respostas da API simuladas)`);
  console.log(`  OUTREACH_AI_MODE=${process.env.OUTREACH_AI_MODE ?? "openai"}`);

  console.log(
    `\n${liveCount === checks.length ? "🟢 Tudo pronto para modo real." : "🟡 Faltam credenciais — o sistema segue operando no que não depende delas."}\n`,
  );
  console.log("Para webhook público em desenvolvimento, exponha a porta 3300 com um túnel:");
  console.log("  npx ngrok http 3300   (ou cloudflared tunnel --url http://localhost:3300)");
}

void main().then(() => process.exit(0));
