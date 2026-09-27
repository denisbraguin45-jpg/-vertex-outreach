# Vertex Outreach

Prospecção multicanal + outreach no Instagram para a **Vertex** — SCRAP → ORGANIZAR → SELECIONAR → COMPOSE → DISPARAR → ACOMPANHAR (WhatsApp, e-mail e Instagram), com funis de clientes e afiliados, contato inicial via navegador, API oficial para continuação e motor de conversa com gate de claims.

> **Operator manual (PT-BR): [SETUP.md](./SETUP.md)**

## Architecture

Modular monolith. Next.js panel + local worker sharing one SQLite database (WAL).

```
src/
  app/                      Next.js App Router panel (PT-BR UI)
    api/webhook/instagram/  Route Handler: Meta webhook (verify + signature + handoff)
    api/                    status, pause, leads, jobs, events, experiments, costs, config
  config/
    business.ts             server-only loader; VERIFIED_CLAIMS gate (assertVerifiedClaim)
    env.ts                  validated environment (fail-fast values)
  db/
    index.ts                schema/migrations (node:sqlite), system_state, events
    leads.ts                lead repo; pipeline/channel state machines; DNC permanent
    prospects.ts            base de contatos multicanal: upsert dedupe, filtros, status, templates, log de disparos
    messages.ts             message repo; idempotent webhook insert; channel ownership lock
    jobs.ts                 durable queue on SQLite (claim/retry/backoff/dead-letter)
    experiments.ts          deterministic assignment; guarded verdict (no early winners)
  features/
    discovery/              public-profile provider (simulated), ICP scoring, discovery job
    prospecting/            SCRAPER multicanal: nichos, Overpass/OSM + Places (opcional), job durável
    conversations/          engine (OpenAI + simulated mode), first contact, handoff
  integrations/
    browser/cdp.ts          Playwright connectOverCDP; own tab; mutex; evidence capture
    instagram/webhook.ts    signature verify, parse, official API send (24h-window aware)
    openai/client.ts        official SDK; models from env; per-call cost tracking
  worker/
    index.ts                durable job loop: discovery, first_contact, follow_up, sweeps
    safety.ts               global pause, circuit breaker, budget guard, operating hours
    rhythm.ts               daily cap, warmup ramp (5/wk +5), randomized interval
```

## Prospecting (Prospecção multicanal)

Fluxo simples, sem qualificação automática — a triagem é do operador:

1. **Prospecção** (`/prospeccao`) — informar nicho, localização (cidade, UF ou região) e quantidade. O scraper usa OpenStreetMap (Overpass, grátis) para volume e Google Places (opcional via `GOOGLE_PLACES_API_KEY`) para avaliação/link do Maps. Job durável `prospect_search` roda no worker com dedupe por fonte.
2. **Base de Contatos** (`/contatos`) — tabela com busca, filtros de canal (WhatsApp/e-mail/Instagram/site) e de status (não contatado → contatado → respondeu → interessado/sem interesse/opt-out), seleção individual/em massa, excluir e exportar CSV (Excel-friendly).
3. **Disparo** (`/disparo`) — compose manual com templates e variável `{{empresa}}`; canais WhatsApp (`wa.me`), e-mail (`mailto:`) e Instagram (link do perfil). O sistema abre as abas prontas e registra cada disparo; o clique de envio é sempre do operador. Opt-out nunca recebe disparo.

Não é CRM completo: a ferramenta existe para achar volume e permitir envio manual configurado.

## Growth OS (comercial + marketing + ECOM Stock)

- **Inteligência assistida** (`src/features/intelligence/ai.ts`): classificação de respostas (opt-out tem prioridade máxima), score 0-100 ponderado, próxima ação/pergunta. OpenAI quando configurada, heurística determinística offline caso contrário. A decisão final é sempre do operador.
- **Comercial** (`/comercial`): inbox classificado → fila SDR → reunião com briefing automático → proposta (deal com valor + recorrência) → venda → **entrega persistida** (VENDIDO → … → RECORRÊNCIA).
- **Pós-venda**: solicitação de depoimento/case/indicação; indicação vira contato na base. Expansão só existe com **sinal real registrado** (novo serviço, automação, manutenção, módulo, expansão de contrato) — a IA nunca inventa oportunidade.
- **Marketing OS** (`/marketing`): pesquisa (dores/objeções/concorrência/ângulos/hipóteses) → geração de hooks, posts, e-mails, anúncios, roteiros e briefs com **nota de conformidade** (sem prova declarada = proibido prometer resultado).
- **ECOM Stock** (`/ecom-stock`): posicionamento + landing copy + plano D-14→D+30 + 6 briefs de imagem e 6 de vídeo, todos com compliance explícito.
- **Money Model** (dashboard): receita inicial, MRR (recorrência dos deals), CAC total e por canal (gastos registrados em `spend`), LTV (horizonte conservador 6 meses) e payback.

Unidade de sucesso: **tempo economizado + custo reduzido + conversão melhorada + receita incremental** — simplicidade antes de features até os dados provarem o contrário.

1. **First contact only via browser** — the official API cannot open a conversation.
2. **Channel ownership lock** — after any inbound, the thread belongs to the API; the browser never touches it again (`canSendVia` in `messages.ts`).
3. **Claims gate** — the system prompt contains only `VERIFIED_CLAIMS`; composed replies are screened against `UNVERIFIED_CLAIMS` cores (`assertNoBlockedClaims`).
4. **DNC is forever** — `do_not_contact` rejects all transitions and re-insertion attempts.
5. **Webhook idempotency** — unique index on `messages.meta_message_id`; Meta retries are safe.
6. **State machines** — pipeline and channel transitions are validated atomically with audit events; invalid jumps return `null`.
7. **Budget circuit** — every AI call checks `OPENAI_MONTHLY_BUDGET_USD`; exceeding pauses the whole system.
8. **Recovery** — stale `running` jobs are requeued on boot (`recoverStaleJobs`).

## States

Pipelines (`src/db/index.ts`): `discovered → qualified → contacted → replied → interested → whatsapp_handoff|joined_affiliate_group → registered|active_affiliate → active_customer|generated_customer → closed`

Channel: `browser_contact_pending → browser_contact_sent → waiting_inbound_reply → api_eligible → api_active → (api_window_closed | human_review_required | do_not_contact | blocked | completed)`

Internal values in English; UI labels in PT-BR.

## Environment

Copy `.env.example` → `.env`. Highlights: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MODEL_FAST`, `OPENAI_MONTHLY_BUDGET_USD`, `CHROME_CDP_URL`, `CHROME_PROFILE_DIR`, `INSTAGRAM_*` (official API), `DATABASE_URL`, `MAX_DMS_PER_DAY`, `MIN/MAX_SECONDS_BETWEEN_DMS`, `OPERATING_HOURS`, `OPERATING_TIMEZONE`, `OUTREACH_DRY_RUN` (default true).

Business config: `config/business.example.json` → `config/business.json` (gitignored). Contains ICP, channels, and the two claim lists.

## Simulation layers

- `OUTREACH_DRY_RUN=true` — browser composes but never sends; full state machine runs.
- `OUTREACH_AI_MODE=simulated` — deterministic classification/replies without network (used by E2E).
- `OUTREACH_AI_SIMULATE_API=1` (default) — official-API sends are simulated with synthetic ids.
- Discovery provider `simulated` — realistic seed profiles; swap the provider interface for a real one later.

Real sends require: `OUTREACH_DRY_RUN=false`, `OUTREACH_AI_MODE=openai` + key, `OUTREACH_AI_SIMULATE_API=0` + Meta credentials, Chrome running with `--remote-debugging-port` on the dedicated profile.

## Commands

```bash
npm run up         # panel (3300) + worker together
npm run dev        # panel only
npm run worker     # worker only
npm run typecheck  # tsc --noEmit
npm test           # node:test — dedupe, transitions, idempotency, channel lock, jobs, experiments
npm run e2e        # full autonomy-cycle simulation with evidence (temp DB)
npm run build      # production build
```

## Testing strategy

1. **Unit/integration** (`npm test`): dedupe, pipeline/channel machines, DNC permanence, webhook idempotency, ownership lock, job claim/retry/dead-letter, restart recovery, experiment guardrails, webhook signature.
2. **E2E simulation** (`npm run e2e`): 15-step evidence run of the whole cycle.
3. **Dry-run real** (operator): real Chrome + real composer, final send blocked.
4. **Smoke real** (operator, explicit authorization): limited real sends.

## Security

- Secrets only in `.env` / `config/business.json` (both gitignored).
- Webhook HMAC-SHA256 verification (`X-Hub-Signature-256`, timing-safe compare).
- Structured event log without tokens/passwords.
- Circuit breaker opens after 5 consecutive failures; auto half-open after 30 min cooldown.
- Screenshots/accessibility snapshots on browser failures under `screenshots/` (gitignored).
