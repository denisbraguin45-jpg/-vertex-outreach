// ─── Simulated AI (offline determinism for tests/E2E) ───────────────────────
// Mimics interpretInbound/composeReply contract without network. Selected by
// OUTREACH_AI_MODE=simulated. Never used when real OpenAI is configured.

import type { Interpretation } from "./engine";
import type { LeadRecord } from "@/db";
import { getBusiness } from "@/config/business";

export function simulateInterpretation(text: string): Interpretation {
  const t = text.toLowerCase();
  if (/(parar|para de|n[ãa]o quero|remover|sair)/.test(t)) {
    return { intent: "opt_out", action: "close", replyDraft: null, confidence: 0.95, reason: "simulated: opt-out keywords" };
  }
  if (/(whatsapp|zap|wpp|n[úu]mero)/.test(t)) {
    return { intent: "wants_whatsapp", action: "handoff_whatsapp", replyDraft: null, confidence: 0.9, reason: "simulated: whatsapp request" };
  }
  if (/(pre[çc]o|valor|quanto custa|investimento)/.test(t)) {
    return { intent: "asked_pricing", action: "handle_objection", replyDraft: null, confidence: 0.85, reason: "simulated: pricing question" };
  }
  if (/(interess|como funciona|conta mais|pode falar|sim)/.test(t)) {
    return { intent: "interested", action: "present", replyDraft: null, confidence: 0.8, reason: "simulated: interest" };
  }
  return { intent: "ambiguous", action: "escalate_human", replyDraft: null, confidence: 0.4, reason: "simulated: unclear" };
}

export function simulateReply(lead: LeadRecord, interpretation: Interpretation): string {
  const b = getBusiness();
  const first = lead.full_name.split(" ")[0];
  switch (interpretation.intent) {
    case "interested":
    case "asked_info":
      return `Boa, ${first}! ${b.company.oneLinePitch}. Fazemos um diagnóstico sem custo e te mostro na prática. Funciona pra você?`;
    case "asked_pricing":
      return `${first}, o investimento depende do escopo — por isso o diagnóstico é sem compromisso. Consigo te mostrar exemplos reais. Te serve?`;
    case "objection":
      return `Entendo, ${first}. Sem pressa: o diagnóstico é gratuito e você decide depois. Topa dar uma olhada?`;
    case "wants_whatsapp":
      return `Perfeito! Te chamo por lá: ${b.channels.whatsappLink} — falo com você ainda hoje.`;
    case "needs_human":
    case "not_the_owner":
      return `Claro! Quem resolve isso é o ${b.owner.name} (${b.owner.role}) pessoalmente. Deixo ele sabendo?`;
    default:
      return `Fico à disposição, ${first}! Qualquer dia me chama por aqui.`;
  }
}
