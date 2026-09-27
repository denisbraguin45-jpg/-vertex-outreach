# Vertex Outreach — Manual do Operador

Sistema de prospecção autônoma da **Vertex** no Instagram: funil de clientes e funil de afiliados, com conversa por IA que respeita a regra de afirmações verificadas.

---

## 1. Instalação (uma vez)

```bash
cd vertex-outreach
npm install
cp .env.example .env
cp config/business.example.json config/business.json
```

Edite:

1. **`config/business.json`** — identidade, links e **afirmações**:
   - `claims.verified`: SÓ o que já está comprovado no site/material oficial. A IA nunca envia nada fora dessa lista.
   - `claims.unverified`: o que ainda precisa de prova — fica bloqueado até você promover para `verified`.
2. **`.env`** — chaves e limites (veja seção 2).

---

## 2. Chave da OpenAI (com freio de segurança)

1. Crie a chave em https://platform.openai.com/api-keys — **num projeto separado**, permissão **Restricted**.
2. Em **Settings → Limits**, defina o **hard limit mensal** (ex.: US$ 50).
3. Preencha no `.env`:
   ```
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4.1-mini
   OPENAI_MODEL_FAST=gpt-4.1-nano
   OPENAI_MONTHLY_BUDGET_USD=50
   ```
O sistema também pausa sozinho ao atingir `OPENAI_MONTHLY_BUDGET_USD` (custo é rastreado chamada a chamada na tabela `ai_calls`).

---

## 3. Chrome dedicado com a sua sessão do Instagram

A primeira DM sai pelo **Chrome real do seu computador** (a API oficial da Meta não abre conversa com quem nunca respondeu). O agente usa a **sua sessão logada**, numa aba própria, sem tocar no seu mouse/teclado.

### Por que um perfil dedicado?

O Chrome 136+ **recusa** `--remote-debugging-port` no perfil padrão. O perfil dedicado (`CHROME_PROFILE_DIR`) é requisito, não preferência.

### Subir o Chrome com debug (perfil dedicado)

**Windows (PowerShell):**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --user-data-dir="C:\Users\SEU_USUARIO\vertex-outreach\.chrome-profile" `
  --remote-debugging-port=9222
```

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --user-data-dir="$HOME/vertex-outreach/.chrome-profile" \
  --remote-debugging-port=9222
```

**Linux:**
```bash
google-chrome \
  --user-data-dir="$HOME/vertex-outreach/.chrome-profile" \
  --remote-debugging-port=9222
```

> ⚠️ **AVISO DE SEGURANÇA**: a porta de debug dá **controle total** sobre a sessão logada.
> Mantenha em `127.0.0.1` — **nunca** `0.0.0.0`, **nunca** em máquina compartilhada.
> Feche essa janela do Chrome quando encerrar a operação.

Depois, **logue no Instagram uma única vez** nessa janela do Chrome. A sessão fica guardada no perfil dedicado.

---

## 4. Rodar (painel + worker)

```bash
npm run up
```

- **Painel**: http://localhost:3300 (Visão Geral, Leads, Conversas, Exceções, Experimentos, Custos, Configurações)
- **Worker**: loop autônomo (descoberta a cada 6h, primeiro contato respeitando ritmo, follow-ups, sweep de janela 24h)

Ou separados:
```bash
npm run dev      # só painel
npm run worker   # só worker
```

---

## 5. Modos de operação

| Modo | O que faz | Quando usar |
|---|---|---|
| `OUTREACH_DRY_RUN=true` (padrão) | Compõe e registra tudo, **envia nada** | Primeiros dias, validar mensagens |
| `OUTREACH_AI_SIMULATE_API=0` + credenciais Meta | Responde pela API oficial de verdade | Após App Review aprovado |
| Botão **Pausar tudo** no painel | Para worker e fila na hora | Qualquer risco percebido |

Para sair do dry-run: painel → **Configurações** → desativar **DRY-RUN ATIVO** (ou apagar `dry_run_override` no banco).

---

## 6. Rotina diária (5 minutos)

1. **Visão Geral** — sistema operando? custo de IA ok?
2. **Exceções** — revisar fila de revisão humana e jobs mortos.
3. **Conversas** — ler fios da API; intervir manualmente no Instagram se precisar.
4. **Experimentos** — acompanhar variantes (não declare vencedor antes da amostra).

---

## 7. O que o sistema faz sozinho (e o que nunca faz)

**Faz sozinho:** descobrir perfis por segmento/keyword, pontuar aderência ao ICP, detectar loja/dono/decisor, escolher janela de envio, redigir abertura pessoal baseada no perfil real, enviar 1ª DM pelo navegador, respeitar cap diário e horários, receber resposta via webhook, assumir o fio pela API, interpretar intenção, responder, encaminhar ao WhatsApp/grupo, agendar follow-up, marcar opt-out como DNC permanente, registrar custo e decisão, pausar sozinho diante de risco.

**Nunca faz:** inventar taxa/condição/garantia/superlativo, prometer aprovação ou resultado financeiro, fingir ser cliente, usar afirmação não verificada, contactar quem pediu para parar, responder pelo navegador depois que a API assumiu o fio, ultrapassar orçamento da OpenAI.

---

## 8. Backup e restauração

```bash
# backup (com o worker parado)
cp data/outreach.db backups/outreach-$(date +%Y%m%d).db

# restaurar
cp backups/outreach-2026-09-25.db data/outreach.db
```

Também copie `.chrome-profile/` se trocar de máquina (é a sua sessão logada).

---

## 9. Se a chave da OpenAI vazar

1. Revogue na hora: https://platform.openai.com/api-keys (Delete key).
2. O hard limit mensal (Settings → Limits) limita o dano financeiro.
3. Crie nova chave num projeto novo, atualize o `.env`, reinicie (`npm run up`).

---

## 10. Perguntas rápidas

**"Por que a DM não saiu?"** → Veja o motivo no painel (Leads → canal) ou no log do worker. Causas comuns: cap diário atingido (warmup), fora da janela 09:00–20:00, Chrome não está rodando com debug, lead em DNC.

**"O painel mostra 'SISTEMA PAUSADO'"** → Leia o motivo no topo do painel. Circuit breaker abriu após 5 falhas seguidas ou orçamento estourou. Resolva a causa e clique **Retomar operação**.

**"Quando ativo a API oficial?"** → Precisa de: conta Instagram Professional, app na Meta com App Review aprovado (mensageria), `INSTAGRAM_PAGE_ACCESS_TOKEN` + `INSTAGRAM_BUSINESS_ACCOUNT_ID` + `INSTAGRAM_APP_SECRET` no `.env`, webhook apontando para `https://SEU-DOMINIO/api/webhook/instagram`. Enquanto isso, o sistema continua com o funil do navegador e registra respostas recebidas manualmente para revisão.
