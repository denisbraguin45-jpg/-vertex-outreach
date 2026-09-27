// ─── Inteligência assistida: classificação, resumo, score, próxima ação ─────
// IA OPCIONAL: com OpenAI configurada usa o modelo; sem, usa heurística
// determinística (mesmo padrão OUTREACH_AI_MODE=simulated do motor de conversa).
// A decisão comercial final é SEMPRE do operador — a IA só sugere.

import { complete, aiConfigured } from "@/integrations/openai/client";

// ─── Classificação de resposta ───────────────────────────────────────────────

export type ReplyIntent =
  | "interesse"
  | "pediu_informacao"
  | "pediu_preco"
  | "objecao"
  | "sem_interesse"
  | "opt_out"
  | "nao_eh_decisor"
  | "encaminhar"
  | "ambigua";

export interface ReplyClassification {
  intent: ReplyIntent;
  summary: string;
  suggestsMeeting: boolean;
  confidence: number;
  reason: string;
  engine: "openai" | "heuristic";
}

const INTENT_LABEL: Record<ReplyIntent, string> = {
  interesse: "interesse",
  pediu_informacao: "pediu informação",
  pediu_preco: "pediu preço",
  objecao: "objeção",
  sem_interesse: "sem interesse",
  opt_out: "opt-out",
  nao_eh_decisor: "não é o decisor",
  encaminhar: "vai encaminhar",
  ambigua: "ambígua",
};

export function intentLabel(intent: ReplyIntent): string {
  return INTENT_LABEL[intent] ?? intent;
}

export async function classifyReply(text: string, leadName: string): Promise<ReplyClassification> {
  if (aiConfigured()) {
    try {
      const res = await complete({
        purpose: "classify_reply",
        leadId: null,
        model: "fast",
        temperature: 0.2,
        maxTokens: 220,
        system: `Você classifica respostas de prospecção B2B. Responda APENAS JSON:
{"intent":"interesse|pediu_informacao|pediu_preco|objecao|sem_interesse|opt_out|nao_eh_decisor|encaminhar|ambigua","summary":"resumo em 1 frase","suggestsMeeting":true|false,"confidence":0-1}
Regras: "opt_out" para qualquer pedido de não receber contato (ex: remover, parar, descadastrar). "nao_eh_decisor" quando quem responde não decide. Nunca invente conteúdo fora do texto.`,
        user: `Lead: ${leadName}\nResposta: ${text.slice(0, 2000)}`,
      });
      const parsed = JSON.parse(res.text) as Partial<ReplyClassification>;
      if (parsed.intent && INTENT_LABEL[parsed.intent as ReplyIntent]) {
        return {
          intent: parsed.intent as ReplyIntent,
          summary: parsed.summary ?? text.slice(0, 120),
          suggestsMeeting: Boolean(parsed.suggestsMeeting),
          confidence: Number(parsed.confidence ?? 0.7),
          reason: "openai",
          engine: "openai",
        };
      }
    } catch {
      // cai para heurística
    }
  }
  return classifyReplyHeuristic(text);
}

export function classifyReplyHeuristic(text: string): ReplyClassification {
  const t = text.toLowerCase();
  const has = (...words: string[]): boolean => words.some((w) => t.includes(w));

  if (has("remover", "descadastrar", "parar de enviar", "não quero receber", "nao quero receber", "não contate", "nao contate", "opt-out", "unsubscribe")) {
    return { intent: "opt_out", summary: "Pedido de remoção da lista.", suggestsMeeting: false, confidence: 0.95, reason: "heuristic: opt-out keywords", engine: "heuristic" };
  }
  if (has("não sou eu", "nao sou eu", "quem cuida disso é", "fale com", "encaminhar para", "passa para")) {
    return { intent: "nao_eh_decisor", summary: "Contato não é o decisor; pediu encaminhamento.", suggestsMeeting: false, confidence: 0.8, reason: "heuristic: not decision maker", engine: "heuristic" };
  }
  if (has("quanto custa", "qual o preço", "qual o valor", "orçamento", "tabela de preços")) {
    return { intent: "pediu_preco", summary: "Pediu preço/orçamento.", suggestsMeeting: false, confidence: 0.85, reason: "heuristic: pricing", engine: "heuristic" };
  }
  if (has("reunião", "reuniao", "chamada", "call", "agenda", "podemos conversar", "me conta mais", "como funciona")) {
    return { intent: "interesse", summary: "Demonstrou interesse em conversar.", suggestsMeeting: true, confidence: 0.8, reason: "heuristic: meeting interest", engine: "heuristic" };
  }
  if (has("interessado", "tem interesse", "quero saber", "mais informações", "mais informacoes", "manda", "pode enviar")) {
    return { intent: "pediu_informacao", summary: "Pediu mais informações.", suggestsMeeting: false, confidence: 0.7, reason: "heuristic: info request", engine: "heuristic" };
  }
  if (has("já tenho", "ja tenho", "não precisamos", "nao precisamos", "sem interesse", "obrigado, mas", "estamos satisfeitos", "caro", "caro demais")) {
    return { intent: "sem_interesse", summary: "Resposta negativa ou objeção de preço/need.", suggestsMeeting: false, confidence: 0.75, reason: "heuristic: objection", engine: "heuristic" };
  }
  return { intent: "ambigua", summary: text.slice(0, 120), suggestsMeeting: false, confidence: 0.4, reason: "heuristic: fallback", engine: "heuristic" };
}

// ─── Score assistido 0-100 (prioridade operacional, não previsão de venda) ───

export interface ScoreFactors {
  fitFinanceiro: number; // 0-10
  potencialOferta: number; // 0-10
  dorOportunidade: number; // 0-10
  interesse: number; // 0-10
  autoridade: number; // 0-10
  timing: number; // 0-10
}

const DEFAULT_WEIGHTS: Record<keyof ScoreFactors, number> = {
  fitFinanceiro: 2,
  potencialOferta: 1.5,
  dorOportunidade: 2,
  interesse: 2.5,
  autoridade: 1.5,
  timing: 1.5,
};

export function computeLeadScore(
  factors: Partial<ScoreFactors>,
  weights: Partial<Record<keyof ScoreFactors, number>> = {},
): { score: number; maxScore: number } {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  let score = 0;
  let maxScore = 0;
  for (const key of Object.keys(DEFAULT_WEIGHTS) as Array<keyof ScoreFactors>) {
    const value = Math.max(0, Math.min(10, Number(factors[key] ?? 0)));
    score += value * w[key];
    maxScore += 10 * w[key];
  }
  return { score: Math.round((score / maxScore) * 100), maxScore: 100 };
}

export async function suggestNextAction(input: {
  companyName: string;
  status: string;
  intent: ReplyIntent | null;
  notes: string | null;
}): Promise<string> {
  if (input.intent === "opt_out") return "Registrar opt-out e não contactar novamente.";
  if (input.status === "nao_contatado") return "Preparar primeiro contato pelo canal disponível (compose).";
  if (input.status === "contatado" && input.intent === "pediu_informacao") return "Enviar material com prova e propor chamada de 15 min.";
  if (input.intent === "pediu_preco") return "Enviar proposta/faixa de preço e sugerir reunião para qualificar fit.";
  if (input.intent === "interesse") return "Agendar reunião e gerar briefing antes da chamada.";
  if (input.status === "respondeu") return "Responder com próxima pergunta sugerida e propor agenda.";
  if (aiConfigured()) {
    try {
      const res = await complete({
        purpose: "suggest_next_action",
        leadId: null,
        model: "fast",
        temperature: 0.4,
        maxTokens: 80,
        system: "Sugira UMA próxima ação comercial curta (1 frase) para o operador. Sem promessas inventadas.",
        user: `Empresa: ${input.companyName}\nStatus: ${input.status}\nIntenção: ${input.intent ?? "desconhecida"}\nNotas: ${(input.notes ?? "").slice(0, 400)}`,
      });
      if (res.text) return res.text;
    } catch {
      // fallback abaixo
    }
  }
  return "Revisar histórico e definir próximo passo manualmente.";
}

/** Próxima pergunta sugerida para a fila do SDR. */
export async function suggestNextQuestion(input: {
  companyName: string;
  niche: string | null;
  painPoint: string | null;
  history: string;
}): Promise<string> {
  if (aiConfigured()) {
    try {
      const res = await complete({
        purpose: "suggest_next_question",
        leadId: null,
        model: "fast",
        temperature: 0.5,
        maxTokens: 80,
        system: "Gere UMA pergunta aberta e curta para qualificar dor/timing em prospecção B2B. Não invente fatos sobre a empresa.",
        user: `Empresa: ${input.companyName}\nNicho: ${input.niche ?? "?"}\nDor mapeada: ${input.painPoint ?? "?"}\nHistórico: ${input.history.slice(0, 600)}`,
      });
      if (res.text) return res.text;
    } catch {
      // fallback
    }
  }
  const pain = input.painPoint ?? "o processo atual";
  return `Hoje, como vocês lidam com ${pain} — e o que mais trava nesse processo?`;
}
