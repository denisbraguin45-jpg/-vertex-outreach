// ─── Geração de conteúdo a partir da pesquisa (assisto, operador aprova) ────
// Regra dura: nenhum asset afirma prova/resultado que não esteja na pesquisa.
// Sem OpenAI, o gerador determinístico entrega estruturas completas.

import { aiConfigured, complete } from "@/integrations/openai/client";
import { listResearch, saveBrief, type BriefKind, type ResearchEntry } from "@/db/marketing";
import { verifiedClaims } from "@/config/business";

export interface GenerateInput {
  market: string;
  kind: BriefKind;
  title?: string;
  offer?: string; // o que a Vertex oferece (usado como mecanismo)
  proof?: string; // prova REAL disponível (opcional)
}

export interface GenerateResult {
  briefId: string;
  title: string;
  hook: string;
  message: string;
  cta: string;
  complianceNote: string;
  content: string;
}

const KIND_SPEC: Record<BriefKind, { label: string; format: string; cta: string }> = {
  hook: { label: "Hooks", format: "3–5 hooks de 1 linha", cta: "Comentar/mandar mensagem" },
  post: { label: "Post", format: "post de rede social", cta: "Comentar ou chamar na DM" },
  email: { label: "E-mail", format: "e-mail frio/warm", cta: "Responder ao e-mail" },
  anuncio: { label: "Anúncio", format: "copy de anúncio pago", cta: "Clicar e agendar demo" },
  roteiro_video: { label: "Roteiro de vídeo", format: "vídeo 30–60s", cta: "Chamar no WhatsApp/agendar" },
  brief_imagem: { label: "Brief de imagem", format: "criativo estático", cta: "Clicar no anúncio" },
};

function compliance(proof?: string): string {
  return proof && proof.trim().length > 8
    ? `Prova declarada: "${proof.trim()}". Usar apenas esta prova; não inflar números.`
    : "SEM PROVA DECLARADA: usar apenas afirmações verificadas do config/business.json; proibido prometer resultado específico.";
}

function researchBlock(entries: ResearchEntry[]): string {
  if (!entries.length) return "Sem pesquisa registrada para este mercado — gere apenas com base na oferta.";
  const byKind = new Map<string, string[]>();
  for (const e of entries) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e.content);
    byKind.set(e.kind, list);
  }
  const label: Record<string, string> = {
    dor: "Dores", objecao: "Objeções", oferta_concorrente: "Concorrência",
    angulo: "Ângulos", hipotese: "Hipóteses",
  };
  return [...byKind.entries()]
    .map(([kind, items]) => `${label[kind] ?? kind}:\n${items.slice(0, 6).map((c) => `- ${c}`).join("\n")}`)
    .join("\n\n");
}

function deterministicDraft(input: GenerateInput, entries: ResearchEntry[]): GenerateResult {
  const spec = KIND_SPEC[input.kind];
  const pains = entries.filter((e) => e.kind === "dor").slice(0, 3).map((e) => e.content);
  const pain = pains[0] ?? "o processo manual que consome tempo do time";
  const title = input.title?.trim() || `${spec.label} · ${input.market}`;
  const hook = pains.length
    ? `${pain.charAt(0).toUpperCase()}${pain.slice(1)} — e o custo invisível disso no seu mês?`
    : `Se você gerencia ${input.market}, provavelmente já perdeu horas com ${pain}.`;

  let content: string;
  switch (input.kind) {
    case "hook":
      content = [
        `1. ${pain.charAt(0).toUpperCase()}${pain.slice(1)} custa mais caro do que parece.`,
        `2. O que muda quando ${input.market} organiza esse processo?`,
        `3. Antes: planilhas e retrabalho. Depois: processo rodando.`,
        `4. "${pain}" — se isso soa familiar, leia até o fim.`,
        `5. Menos tempo apagando incêndio, mais tempo crescendo.`,
      ].join("\n");
      break;
    case "email":
      content = [
        `Assunto: sobre ${pain} em ${input.market}`,
        ``,
        `Oi [NOME],`,
        ``,
        `Vi que você atua em ${input.market}. O problema que mais vejo nessa operação é: ${pain}.`,
        input.offer ? `Resolvemos isso com ${input.offer}.` : `Temos um mecanismo específico para isso.`,
        input.proof ? `Prova: ${input.proof}.` : "",
        ``,
        `Faz sentido uma conversa de 15 minutos?`,
        ``,
        `[Assinatura Vertex]`,
      ].filter(Boolean).join("\n");
      break;
    case "roteiro_video":
      content = [
        `[0-3s] Hook: ${hook}`,
        `[3-10s] Problema: expandir sobre ${pain} — cena do processo manual.`,
        `[10-25s] Mecanismo: ${input.offer ?? "mostrar o produto resolvendo"}.`,
        `[25-40s] Antes/depois: como a operação fica após a mudança.`,
        input.proof ? `[40-50s] Prova: ${input.proof}.` : `[40-50s] Demo da interface (sem claim de resultado).`,
        `[50-60s] CTA: ${spec.cta}.`,
      ].join("\n");
      break;
    case "brief_imagem":
      content = [
        `Formato: ${spec.format} (1080x1080 e 1080x1350).`,
        `Conceito: antes x depois — ${pain} vs processo organizado.`,
        `Headline: ${hook}`,
        input.offer ? `Sub: ${input.offer}` : "",
        `CTA: ${spec.cta}`,
        `Nota: usar UI real do produto; sem números inflados.`,
      ].filter(Boolean).join("\n");
      break;
    default:
      content = [
        `Hook: ${hook}`,
        ``,
        `Desenvolvimento: conectar a dor (${pain}) com o mecanismo (${input.offer ?? input.offer ?? "produto"}).`,
        input.proof ? `Prova: ${input.proof}.` : "Prova: apenas claims verificados.",
        `CTA: ${spec.cta}`,
      ].join("\n");
  }

  return {
    briefId: "",
    title,
    hook,
    message: pain,
    cta: spec.cta,
    complianceNote: compliance(input.proof),
    content,
  };
}

async function aiPolish(input: GenerateInput, draft: GenerateResult, entries: ResearchEntry[]): Promise<string> {
  const res = await complete({
    purpose: "marketing_generate",
    leadId: null,
    model: "main",
    temperature: 0.7,
    maxTokens: 600,
    system: `Você gera conteúdo de marketing B2B em PT-BR para a Vertex. Regras rígidas:
1. Use APENAS as dores/provas fornecidas — nunca invente número, caso ou resultado.
2. Claims permitidos: ${verifiedClaims().slice(0, 6).join(" | ") || "(nenhum claim comercial — usar linguagem neutra)"}.
3. Retorne o asset pronto para uso, sem comentários.`,
    user: `Tipo: ${KIND_SPEC[input.kind].label} (${KIND_SPEC[input.kind].format})
Mercado: ${input.market}
Oferta/mechanismo: ${input.offer ?? "(fornecido acima nos claims)"}
Prova real disponível: ${input.proof ?? "nenhuma"}
Pesquisa:
${researchBlock(entries)}

Rascunho base:
${draft.content}`,
  });
  return res.text || draft.content;
}

export async function generateAsset(input: GenerateInput): Promise<GenerateResult & { engine: "openai" | "deterministic" }> {
  const entries = listResearch(input.market);
  const draft = deterministicDraft(input, entries);
  let content = draft.content;
  let engine: "openai" | "deterministic" = "deterministic";
  if (aiConfigured()) {
    try {
      content = await aiPolish(input, draft, entries);
      engine = "openai";
    } catch {
      // mantém determinístico
    }
  }
  const brief = saveBrief({
    kind: input.kind,
    title: draft.title,
    audience: `Decisores em ${input.market}`,
    hook: draft.hook,
    message: draft.message,
    proof: input.proof ?? null,
    cta: draft.cta,
    format: KIND_SPEC[input.kind].format,
    complianceNote: draft.complianceNote,
    content,
  });
  return { ...draft, briefId: brief.id, content, engine };
}
