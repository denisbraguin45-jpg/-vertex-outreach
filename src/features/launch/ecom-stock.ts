// ─── ECOM Stock Launch: posicionamento, plano D-14..D+30, assets ────────────
// Módulo separado do prospecting. Nunca gera copy com claim que o produto
// não comprova: só usa provas declaradas nos inputs ou claims verificados.

import { aiConfigured, complete } from "@/integrations/openai/client";
import { verifiedClaims } from "@/config/business";
import { saveBrief, addCalendarItem, type BriefKind } from "@/db/marketing";
import { getDb, nowISO, newId } from "@/db";

// ─── Entradas (ICP, dores, features reais, prova, preço, canais) ─────────────

export interface LaunchInputs {
  productName: string; // "ECOM Stock"
  icp: string; // ex: "donos de e-commerce com 50-500 pedidos/mês"
  pains: string[]; // dores reais mapeadas
  features: string[]; // funcionalidades REAIS do produto
  proof: string[]; // provas disponíveis (vazio = nenhuma)
  price: string; // ex: "R$ 197/mês com trial de 7 dias"
  trialModel: string; // ex: "demo guiada + trial sem cartão"
  channels: string[]; // ex: ["instagram", "email", "whatsapp"]
}

export interface LaunchPositioning {
  statement: string;
  offer: string;
  landingHeadline: string;
  landingSub: string;
  landingCta: string;
  complianceNote: string;
}

export interface PlanPhase {
  window: string; // "D-14 a D-8"
  goal: string;
  contents: string[];
}

export interface CreativeBriefOutput {
  kind: BriefKind;
  objective: string;
  audience: string;
  hook: string;
  message: string;
  proof: string;
  cta: string;
  format: string;
  complianceNote: string;
  content: string;
}

export interface LaunchPlan {
  inputs: LaunchInputs;
  positioning: LaunchPositioning;
  phases: PlanPhase[];
  imageBriefs: CreativeBriefOutput[];
  videoBriefs: CreativeBriefOutput[];
  engine: "openai" | "deterministic";
  createdAt: string;
}

// ─── Persistência mínima (system_state: último plano gerado) ─────────────────

const STATE_KEY = "ecom_stock_launch_plan";

export function saveLaunchPlan(plan: LaunchPlan): void {
  getDb()
    .prepare("INSERT INTO system_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(`${STATE_KEY}_${new Date().toISOString().slice(0, 10)}`, JSON.stringify({ ...plan, createdAt: nowISO() }));
  getDb()
    .prepare("INSERT INTO system_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(STATE_KEY, JSON.stringify({ ...plan, createdAt: nowISO() }));
}

export function getLaunchPlan(): LaunchPlan | null {
  const row = getDb().prepare("SELECT value FROM system_state WHERE key = ?").get(STATE_KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as LaunchPlan;
  } catch {
    return null;
  }
}

// ─── Compliance ──────────────────────────────────────────────────────────────

function complianceNote(inputs: LaunchInputs): string {
  return inputs.proof.length
    ? `Provas autorizadas neste plano: ${inputs.proof.join(" | ")}. Nenhum asset pode citar número/caso fora desta lista.`
    : "NENHUMA prova registrada: assets usam apenas demonstração da interface e claims neutros. Proibido prometer resultado, % ou economia específica.";
}

// ─── Posicionamento + landing copy (determinístico; IA polisha se ativa) ─────

function deterministicPositioning(inputs: LaunchInputs): LaunchPositioning {
  const pain = inputs.pains[0] ?? "controle de estoque manual";
  const feature = inputs.features[0] ?? "controle de estoque em tempo real";
  const statement = `Para ${inputs.icp}, ${inputs.productName} é o ${feature} que elimina ${pain} — sem migrar de plataforma.`;
  const offer = inputs.price
    ? `${inputs.productName}: ${feature}. ${inputs.price}. ${inputs.trialModel}.`
    : `${inputs.productName}: ${feature}. ${inputs.trialModel}.`;
  return {
    statement,
    offer,
    landingHeadline: `Chega de ${pain}`,
    landingSub: `${feature} para ${inputs.icp}. ${inputs.trialModel}.`,
    landingCta: "Começar o teste grátis",
    complianceNote: complianceNote(inputs),
  };
}

// ─── Plano D-14..D+30 ────────────────────────────────────────────────────────

export function buildLaunchPhases(inputs: LaunchInputs): PlanPhase[] {
  const pain = inputs.pains[0] ?? "gestão manual de estoque";
  return [
    {
      window: "D-14 a D-8",
      goal: "Atenção + pesquisa + lista de espera",
      contents: [
        `Post bastidores: por que construímos ${inputs.productName} (a dor: ${pain})`,
        "Enquete/pesquisa com o ICP sobre o processo atual de estoque",
        "Abrir lista de espera com incentivo de early adopter",
      ],
    },
    {
      window: "D-7 a D-3",
      goal: "Demonstrações + comparações + hooks",
      contents: [
        "Vídeo demo de 60s mostrando a funcionalidade principal",
        "Comparativo: planilha vs sistema (sem inflar números)",
        "3 posts com hooks diferentes apontando para a demo",
      ],
    },
    {
      window: "D-2 a D-1",
      goal: "Contagem regressiva + prova + CTA",
      contents: [
        inputs.proof.length ? `Post de prova: ${inputs.proof[0]}` : "Post de demo aprofundada (sem claim de resultado)",
        "Stories contagem regressiva para o lançamento",
        "E-mail para lista de espera com CTA direto",
      ],
    },
    {
      window: "D0",
      goal: "Lançamento + demo + oferta",
      contents: [
        `Publicar oferta: ${inputs.price} · ${inputs.trialModel}`,
        "Vídeo demo completo + walkthrough da interface",
        "Anúncio nos canais definidos",
      ],
    },
    {
      window: "D+1 a D+7",
      goal: "FAQ + objeções + prova",
      contents: [
        "Post respondendo as 5 objeções mais comuns",
        "FAQ na landing",
        inputs.proof.length ? "Case/depoimento (com autorização)" : "Onboarding em destaque para primeiros usuários",
      ],
    },
    {
      window: "D+8 a D+30",
      goal: "Otimização + retargeting + onboarding + referral",
      contents: [
        "Retargeting com criativos de objeção",
        "Medir ativação (1º estoque importado) e otimizar onboarding",
        "Programa de indicação para clientes ativos",
      ],
    },
  ];
}

// ─── Briefs de imagem (6 ângulos do spec) ────────────────────────────────────

export function buildImageBriefs(inputs: LaunchInputs): CreativeBriefOutput[] {
  const pain = inputs.pains[0] ?? "gestão manual de estoque";
  const feature = inputs.features[0] ?? "estoque em tempo real";
  const spec: Array<{ objective: string; hook: string; message: string; format: string }> = [
    { objective: "Dor operacional", hook: `Ainda controla estoque em planilha?`, message: pain, format: "estático 1080x1080" },
    { objective: "Interface/produto", hook: `É assim que o ${feature} funciona`, message: feature, format: "screenshot UI 1080x1350" },
    { objective: "Antes x depois", hook: "Planilha caótica → painel organizado", message: `${pain} vs ${feature}`, format: "split antes/depois" },
    { objective: "Resultado/clareza", hook: "Você em 5 minutos: todo o estoque mapeado", message: feature, format: "estático com produto" },
    { objective: "Prova", hook: inputs.proof[0] ?? "Veja o produto funcionando", message: inputs.proof[0] ?? "demo real", format: "card de prova/demo" },
    { objective: "Marca", hook: `${inputs.productName}: estoque sob controle`, message: "posicionamento de marca", format: "branding simples" },
  ];
  return spec.map((s) => ({
    kind: "brief_imagem" as BriefKind,
    objective: s.objective,
    audience: inputs.icp,
    hook: s.hook,
    message: s.message,
    proof: inputs.proof[0] ?? "—",
    cta: "Começar o teste grátis",
    format: s.format,
    complianceNote: complianceNote(inputs),
    content: `Objetivo: ${s.objective}\nPúblico: ${inputs.icp}\nHook: ${s.hook}\nMensagem central: ${s.message}\nProva disponível: ${inputs.proof[0] ?? "nenhuma (usar apenas demo/claims neutros)"}\nCTA: Começar o teste grátis\nFormato: ${s.format}`,
  }));
}

// ─── Briefs de vídeo (6 ângulos do spec) ─────────────────────────────────────

export function buildVideoBriefs(inputs: LaunchInputs): CreativeBriefOutput[] {
  const pain = inputs.pains[0] ?? "gestão manual de estoque";
  const feature = inputs.features[0] ?? "estoque em tempo real";
  const spec: Array<{ objective: string; hook: string; script: string }> = [
    { objective: "Problema", hook: `Quanto tempo você perdeu com estoque essa semana?`, script: `[0-5s] Hook\n[5-20s] ${pain} em cena\n[20-35s] Custo disso no mês\n[35-50s] Apresentar ${feature}\n[50-60s] CTA` },
    { objective: "Demonstração", hook: "Olha só como funciona em 60 segundos", script: `[0-5s] Hook\n[5-45s] Screen record: ${feature}\n[45-60s] CTA trial` },
    { objective: "Antes/depois", hook: "De planilha para sistema em um dia", script: `[0-5s] Hook\n[5-25s] Antes (caos)\n[25-45s] Depois (organizado)\n[45-60s] CTA` },
    { objective: "Dor financeira", hook: "Produto parado é dinheiro parado", script: `[0-5s] Hook\n[5-30s] Estoque parado/capital girando\n[30-50s] Como ${feature} ajuda a decidir compra\n[50-60s] CTA` },
    { objective: "Bastidores/fundador", hook: "Por que eu construí isso", script: `[0-5s] Hook\n[5-40s] História: a dor real que originou o produto\n[40-55s] Convite para testar\n[55-60s] CTA` },
    { objective: "Objeções", hook: '"Deve ser difícil de migrar…"', script: `[0-5s] Hook (objeção dita em voz alta)\n[5-40s] Resposta objetiva para 3 objeções\n[40-60s] CTA demo` },
  ];
  return spec.map((s) => ({
    kind: "roteiro_video" as BriefKind,
    objective: s.objective,
    audience: inputs.icp,
    hook: s.hook,
    message: s.objective,
    proof: inputs.proof[0] ?? "—",
    cta: "Começar o teste grátis",
    format: "vídeo 30-60s",
    complianceNote: complianceNote(inputs),
    content: `Objetivo: ${s.objective}\nPúblico: ${inputs.icp}\nHook: ${s.hook}\nMensagem central: ${pain ? pain.charAt(0).toUpperCase() + pain.slice(1) : s.objective}\nProva disponível: ${inputs.proof[0] ?? "nenhuma — usar apenas demo real"}\nCTA: Começar o teste grátis\nFormato: vídeo 30-60s\n\nRoteiro:\n${s.script}`,
  }));
}

// ─── Geração completa do plano ───────────────────────────────────────────────

export function createLaunchPlan(inputs: LaunchInputs): LaunchPlan {
  const positioning = deterministicPositioning(inputs);
  const plan: LaunchPlan = {
    inputs,
    positioning,
    phases: buildLaunchPhases(inputs),
    imageBriefs: buildImageBriefs(inputs),
    videoBriefs: buildVideoBriefs(inputs),
    engine: "deterministic",
    createdAt: nowISO(),
  };
  return plan;
}

export async function createLaunchPlanWithAi(inputs: LaunchInputs): Promise<LaunchPlan> {
  const plan = createLaunchPlan(inputs);
  if (!aiConfigured()) return plan;
  try {
    const res = await complete({
      purpose: "launch_positioning",
      leadId: null,
      model: "main",
      temperature: 0.6,
      maxTokens: 500,
      system: `Você cria posicionamento de SaaS em PT-BR. Regras: use SOMENTE as features e provas fornecidas; nunca invente resultado, número ou case. Claims verificados da empresa: ${verifiedClaims().slice(0, 5).join(" | ") || "nenhum"}. Retorne JSON: {"statement":"...","offer":"...","landingHeadline":"...","landingSub":"...","landingCta":"..."}`,
      user: `Produto: ${inputs.productName}\nICP: ${inputs.icp}\nDores: ${inputs.pains.join("; ")}\nFeatures reais: ${inputs.features.join("; ")}\nProvas: ${inputs.proof.length ? inputs.proof.join("; ") : "NENHUMA"}\nPreço: ${inputs.price}\nTrial: ${inputs.trialModel}`,
    });
    const parsed = JSON.parse(res.text) as Partial<LaunchPositioning>;
    if (parsed.statement && parsed.landingHeadline) {
      plan.positioning = { ...plan.positioning, ...parsed };
      plan.engine = "openai";
    }
  } catch {
    // mantém determinístico
  }
  saveLaunchPlan(plan);

  // Persistir briefs no banco de criativos + calendário de lançamento
  for (const brief of [...plan.imageBriefs, ...plan.videoBriefs]) {
    saveBrief({
      kind: brief.kind,
      title: `${brief.objective} · ${inputs.productName}`,
      audience: brief.audience,
      hook: brief.hook,
      message: brief.message,
      proof: brief.proof === "—" ? null : brief.proof,
      cta: brief.cta,
      format: brief.format,
      complianceNote: brief.complianceNote,
      content: brief.content,
    });
  }
  const startOffset = 14;
  for (const phase of plan.phases) {
    addCalendarItem({ title: `${phase.window} — ${phase.goal}`, channel: "launch", plannedDate: null });
  }
  void startOffset;
  return plan;
}
