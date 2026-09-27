// ─── Conversation engine (OpenAI) ───────────────────────────────────────────
// Every commercial statement passes the VERIFIED_CLAIMS gate. The system
// prompt is built strictly from verified claims + public profile context.
// Opt-out is honored instantly and permanently.

import { complete, aiConfigured, OpenAiNotConfiguredError } from "@/integrations/openai/client";
import { verifiedClaims, getBusiness } from "@/config/business";
import { appendMessage, leadHistory } from "@/db/messages";
import { transitionLead, markDoNotContact, setNextAction, appendNote } from "@/db/leads";
import { recordEvent } from "@/db/index";
import type { AiAction, Intent, LeadRecord } from "@/db";

export interface Interpretation {
  intent: Intent;
  action: AiAction;
  replyDraft: string | null;
  confidence: number;
  reason: string;
}

const INTENT_VALUES: Intent[] = [
  "interested", "asked_info", "asked_pricing", "wants_whatsapp", "not_the_owner",
  "will_forward", "objection", "not_interested", "opt_out", "ambiguous", "needs_human",
];

const ACTION_VALUES: AiAction[] = [
  "reply", "ask", "present", "handle_objection", "handoff_whatsapp",
  "handoff_affiliate_group", "wait", "schedule_followup", "close", "escalate_human",
];

/** AI mode: "simulated" (offline deterministic) or "openai" (default). */
function aiMode(): "simulated" | "openai" {
  return /^(1|true|yes)$/i.test(process.env.OUTREACH_AI_MODE === "simulated" ? "1" : "") ? "simulated" : "openai";
}

// ─── System prompt built from verified claims only ──────────────────────────

export function buildSystemPrompt(lead: LeadRecord): string {
  const b = getBusiness();
  const claims = verifiedClaims();
  return [
    `Você é o assistente comercial de ${b.owner.name} (${b.owner.role}) da ${b.company.name}.`,
    `Pitch de uma linha: ${b.company.oneLinePitch}`,
    `Como funciona: ${b.company.howItWorks.join(" → ")}`,
    `Jargão do mercado: ${b.company.marketJargon ?? "experiência digital premium"}`,
    "",
    "REGRAS INEGOCIÁVEIS:",
    "1. Você SÓ pode afirmar comercialmente o que está em AFIRMAÇÕES VERIFICADAS abaixo. Sem paráfrase que invente taxa, condição, garantia, relação societária ou superlativo.",
    "2. NUNCA prometa aprovação de conta ou resultado financeiro.",
    "3. NUNCA finja ser cliente, nem use informação falsa para obter resposta.",
    "4. Tom: conversa pessoal, curta, verdadeira, baseada no conteúdo real do perfil. Não é campanha.",
    "5. Pedido de parar = opt_out imediato, sem follow-up.",
    "6. Onboarding segue regras de cadastro, KYC, KYB e PLD da empresa. Não dê atalhos.",
    "",
    "AFIRMAÇÕES VERIFICADAS (única fonte permitida):",
    ...(claims.length ? claims.map((c) => `- ${c}`) : ["- (nenhuma cadastrada: não faça afirmações comerciais, apenas converse e agende)"]),
    "",
    `Links que você pode enviar: WhatsApp ${b.channels.whatsappLink}${lead.funnel === "affiliates" ? ` · Grupo de afiliados ${b.channels.affiliateGroupLink}` : ""}.`,
  ].join("\n");
}

export function buildContextUser(lead: LeadRecord): string {
  const history = leadHistory(lead.id)
    .slice(-12)
    .map((m) => `${m.direction === "inbound" ? "LEAD" : "VOCÊ"} (${m.channel}): ${m.body}`)
    .join("\n");
  const b = getBusiness();
  const funnelGoal =
    lead.funnel === "clients"
      ? `Objetivo: entender a necessidade da loja (${b.company.marketJargon ?? "experiência digital"}) e encaminhar decisores para o WhatsApp.`
      : `Objetivo: apresentar o programa de afiliados, explicar link individual e remuneração (SÓ o que está verificado) e encaminhar para o grupo.`;
  return [
    `PERFIL PÚBLICO:`,
    `- Nome: ${lead.full_name} (@${lead.instagram_handle})`,
    `- Tipo: ${lead.profile_type} · Nicho: ${lead.niche ?? "n/d"} · Segmento: ${lead.segment ?? "n/d"}`,
    `- Bio: ${lead.bio ?? "n/d"}`,
    `- Seguidores: ${lead.followers} · Local: ${lead.location ?? "n/d"}`,
    funnelGoal,
    "",
    `HISTÓRICO DA CONVERSA:`,
    history || "(sem mensagens ainda)",
  ].join("\n");
}

// ─── Interpret inbound message (fast model) ─────────────────────────────────

export async function interpretInbound(lead: LeadRecord, inboundText: string): Promise<Interpretation> {
  if (aiMode() === "simulated") {
    const { simulateInterpretation } = await import("./simulated-ai");
    return simulateInterpretation(inboundText);
  }
  if (!aiConfigured()) {
    return fallbackInterpretation(inboundText);
  }
  try {
    const res = await complete({
      purpose: "classify_intent",
      leadId: lead.id,
      model: "fast",
      temperature: 0,
      maxTokens: 200,
      system: [
        "Classifique a mensagem do lead e escolha a próxima ação.",
        `Intenções possíveis: ${INTENT_VALUES.join(", ")}.`,
        `Ações possíveis: ${ACTION_VALUES.join(", ")}.`,
        "Responda APENAS JSON válido: {\"intent\": string, \"action\": string, \"confidence\": number, \"reason\": string}",
        "Regra: pedido de parar/ignorar = opt_out; ofensa ou assunto pessoal = opt_out; pergunta de preço = asked_pricing + handle_objection; quer conversar no WhatsApp = wants_whatsapp + handoff_whatsapp (clientes) ou handoff_affiliate_group (afiliados).",
      ].join("\n"),
      user: buildContextUser(lead) + `\n\nNOVA MENSAGEM DO LEAD: ${inboundText}`,
    });
    const parsed = safeJson(res.text);
    const intent: Intent = (INTENT_VALUES as string[]).includes(parsed.intent) ? (parsed.intent as Intent) : "ambiguous";
    let action: AiAction = (ACTION_VALUES as string[]).includes(parsed.action) ? (parsed.action as AiAction) : "wait";
    if (intent === "opt_out") action = "close";
    return {
      intent,
      action,
      replyDraft: null,
      confidence: Number(parsed.confidence ?? 0.5),
      reason: parsed.reason ?? "classified",
    };
  } catch (err) {
    recordEvent("error", "ai_interpret_failed", { error: err instanceof Error ? err.message : String(err) }, lead.id);
    return fallbackInterpretation(inboundText);
  }
}

function fallbackInterpretation(text: string): Interpretation {
  const t = text.toLowerCase();
  if (/(parar|para de|n[ãa]o quero|remover|unsubscribe|sair)/.test(t)) {
    return { intent: "opt_out", action: "close", replyDraft: null, confidence: 0.9, reason: "keyword opt-out" };
  }
  if (/(whatsapp|zap|wpp)/.test(t)) {
    return { intent: "wants_whatsapp", action: "handoff_whatsapp", replyDraft: null, confidence: 0.8, reason: "keyword whatsapp" };
  }
  if (/(pre[çc]o|valor|quanto|investimento)/.test(t)) {
    return { intent: "asked_pricing", action: "handle_objection", replyDraft: null, confidence: 0.7, reason: "keyword pricing" };
  }
  if (/(interess|sim|pode falar|manda)/.test(t)) {
    return { intent: "interested", action: "present", replyDraft: null, confidence: 0.6, reason: "keyword interest" };
  }
  return { intent: "ambiguous", action: "escalate_human", replyDraft: null, confidence: 0.3, reason: "no keywords + AI unavailable" };
}

// ─── Compose reply (main model) with claims gate ────────────────────────────

export async function composeReply(lead: LeadRecord, interpretation: Interpretation): Promise<string | null> {
  const actionToPrompt: Record<AiAction, string> = {
    reply: "responda de forma curta e pessoal",
    ask: "faça UMA pergunta curta para entender a necessidade",
    present: `apresente ${getBusiness().company.name} em 2 frases, usando somente afirmações verificadas`,
    handle_objection: "trate a objeção com honestidade, sem prometer nada além das afirmações verificadas",
    handoff_whatsapp: `convide para continuar no WhatsApp (${getBusiness().channels.whatsappLink}) em 1 frase`,
    handoff_affiliate_group: `convide para entrar no grupo de afiliados (${getBusiness().channels.affiliateGroupLink}) em 1 frase`,
    wait: "responda que aguarda o melhor momento, 1 frase",
    schedule_followup: "combine gentilmente de retomar o contato depois, 1 frase",
    close: "agradeça e se despeça cordialmente, 1 frase",
    escalate_human: "diga que o responsável vai responder pessoalmente, 1 frase",
  };

  if (aiMode() === "simulated") {
    const { simulateReply } = await import("./simulated-ai");
    return sanitizeReply(simulateReply(lead, interpretation), lead.funnel);
  }
  try {
    const res = await complete({
      purpose: "compose_reply",
      leadId: lead.id,
      model: "main",
      temperature: 0.8,
      maxTokens: 220,
      system: buildSystemPrompt(lead),
      user: `${buildContextUser(lead)}\n\nINTENÇÃO DETECTADA: ${interpretation.intent}\nAÇÃO: ${actionToPrompt[interpretation.action]}\n\nEscreva a mensagem agora (máx. 45 palavras, PT-BR, sem emojis demais, sem pressão, sem invenção).`,
    });

    const text = sanitizeReply(res.text, lead.funnel);
    assertNoBlockedClaims(text);
    return text;
  } catch (err) {
    if (err instanceof OpenAiNotConfiguredError) throw err;
    recordEvent("error", "ai_compose_failed", { error: err instanceof Error ? err.message : String(err) }, lead.id);
    return null;
  }
}

/** Removes link of the wrong funnel and trims length. */
function sanitizeReply(text: string, funnel: "clients" | "affiliates"): string {
  const b = getBusiness();
  let t = text.trim();
  if (funnel === "clients") t = t.replaceAll(b.channels.affiliateGroupLink, "").trim();
  if (funnel === "affiliates") t = t.replaceAll(b.channels.whatsappLink, "").trim();
  return t.slice(0, 480);
}

/** Hard gate: composed reply must not contain any UNVERIFIED claim content. */
export function assertNoBlockedClaims(reply: string): void {
  const blocked = getBusiness().claims.unverified
    .filter((c) => !c.includes("{{"))
    .map((c) => c.toLowerCase());
  const lower = reply.toLowerCase();
  for (const claim of blocked) {
    // substring check on the claim's distinctive core (first 6+ words)
    const core = claim.split(/\s+/).slice(0, 6).join(" ");
    if (core.length >= 10 && lower.includes(core)) {
      throw new Error(`Blocked claim leaked into reply: "${core}..."`);
    }
  }
}

function safeJson(text: string): { intent: string; action: string; confidence?: number; reason?: string } {
  try {
    const match = /\{[\s\S]*\}/.exec(text);
    if (match) return JSON.parse(match[0]);
  } catch {
    /* fallthrough */
  }
  return { intent: "ambiguous", action: "escalate_human" };
}

// ─── First-contact opening (browser funnel) ─────────────────────────────────

export interface OpeningVariant {
  key: string;
  text: string;
}

export async function composeOpening(lead: LeadRecord, variantKey: string): Promise<string> {
  // Deterministic fallback template when AI is unavailable — still true and personal.
  const fallback = `Oi ${lead.full_name.split(" ")[0]}! Vi o conteúdo de vocês sobre ${
    lead.niche?.replace("_", " ") ?? "o segmento"
  } e curti o que estão fazendo. Trabalho com comunicação digital e tenho uma ideia rápida que pode fazer sentido pro ${lead.profile_type === "store" ? "negócio de vocês" : "seu projeto"}. Posso compartilhar?`;

  if (!aiConfigured()) return fallback;

  try {
    const res = await complete({
      purpose: "compose_opening",
      leadId: lead.id,
      model: "main",
      temperature: 0.9,
      maxTokens: 140,
      system: buildSystemPrompt(lead),
      user: `${buildContextUser(lead)}\n\nVARIANTE DE ABERTURA: ${variantKey}\nEscreva a PRIMEIRA mensagem (máx. 35 palavras): curta, pessoal, verdadeira, baseada no perfil. Sem pitch agressivo, sem promessa, sem inventar nada. Termina com uma pergunta leve de permissão ou interesse.`,
    });
    assertNoBlockedClaims(res.text);
    return res.text.slice(0, 400);
  } catch (err) {
    recordEvent("warn", "opening_fallback_used", { error: err instanceof Error ? err.message : String(err) }, lead.id);
    return fallback;
  }
}

// ─── Apply action to lead state ─────────────────────────────────────────────

export async function applyAction(
  lead: LeadRecord,
  interpretation: Interpretation,
  reply: string | null,
): Promise<void> {
  switch (interpretation.intent) {
    case "opt_out":
      markDoNotContact(lead.id, "opt_out na conversa");
      if (reply) appendMessage({ lead_id: lead.id, direction: "outbound", channel: "api", body: reply, ai_action: "close", intent: "opt_out" });
      return;
    case "wants_whatsapp": {
      const funnel = lead.funnel;
      const toPipeline = funnel === "clients" ? "whatsapp_handoff" : "joined_affiliate_group";
      transitionLead(lead.id, toPipeline as LeadRecord["pipeline"], "api_active", "lead pediu WhatsApp");
      if (reply) appendMessage({ lead_id: lead.id, direction: "outbound", channel: "api", body: reply, ai_action: funnel === "clients" ? "handoff_whatsapp" : "handoff_affiliate_group", intent: interpretation.intent });
      appendNote(lead.id, `Link enviado: ${funnel === "clients" ? getBusiness().channels.whatsappLink : getBusiness().channels.affiliateGroupLink}`);
      return;
    }
    case "not_interested":
      transitionLead(lead.id, "closed", "completed", "lead não tem interesse");
      if (reply) appendMessage({ lead_id: lead.id, direction: "outbound", channel: "api", body: reply, ai_action: "close", intent: interpretation.intent });
      return;
    case "needs_human":
    case "not_the_owner":
    case "ambiguous":
      transitionLead(lead.id, null, "human_review_required", `intent ${interpretation.intent}`);
      if (reply) appendMessage({ lead_id: lead.id, direction: "outbound", channel: "api", body: reply, ai_action: "escalate_human", intent: interpretation.intent });
      return;
    default: {
      transitionLead(lead.id, "interested", "api_active", `intent ${interpretation.intent}`);
      if (reply) appendMessage({ lead_id: lead.id, direction: "outbound", channel: "api", body: reply, ai_action: interpretation.action, intent: interpretation.intent });
      // schedule follow-up if no reply in 3 days
      setNextAction(lead.id, new Date(Date.now() + 3 * 86_400_000).toISOString());
    }
  }
}
