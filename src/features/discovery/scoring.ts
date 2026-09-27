// ─── ICP scoring: adherence 0-100 for both funnels ───────────────────────────
// Uses only PUBLIC profile signals. Roles detected: store, employee, owner,
// decision_maker, creator. Priority: 1 (high) … 3 (low).

import type { FunnelKind, LeadRecord } from "@/db";
import { getBusiness } from "@/config/business";

export interface ScoreResult {
  score: number;
  priority: 1 | 2 | 3;
  profile_type: LeadRecord["profile_type"];
  niche: string | null;
  matchedSignals: string[];
}

const OWNER_HINTS = /\b(dono|propriet[áa]ri|ceo|founder|fundador|sócio|socio|owner|diretor|gerente geral)\b/i;
const EMPLOYEE_HINTS = /\b(vendedor|consultor|atendente|assistente|analista|colaborador|equipe)\b/i;
const STORE_HINTS = /\b(loja|concession[áa]ria|dealer|imobili[áa]ria|broker|boutique|oficial|distribuidor|estaleiro|marina)\b/i;
const CREATOR_HINTS = /\b(criador|creator|influenc|afiliado|affiliate|conte[úu]do)\b/i;

const LUXURY_HINTS = /\b(luxo|luxury|premium|alto padr[ãa]o|supercarro|esportivo|importad|blindad|exotic|hypercar|yacht|jetski|lancha|ferrari|lamborghini|porsche|maserati|bentley|rolls|aston|mclaren|bmw|mercedes|audi|range rover|lexus)\b/i;
const REAL_ESTATE_HINTS = /\b(imobili[áa]ria|imóveis|imoveis|real estate|corretor|creci|lan[çc]amento|alto padr[ãa]o|cobertura|mans[ãa]o)\b/i;
const JETSKI_HINTS = /\b(jetski|jet ski|moto aqu[áa]tica|n[áa]utica|lancha|barco|marina)\b/i;

export function scoreClientLead(profile: {
  full_name: string;
  handle: string;
  bio?: string | null;
  followers?: number;
  category?: string | null;
  postsSample?: string[];
  location?: string | null;
}): ScoreResult {
  const business = safeBusiness();
  const segments = (business?.icp.segments ?? []).map((s) => s.replace(/\{\{|\}\}/g, ""));
  const keywords = (business?.icp.keywords ?? []).map((k) => k.replace(/\{\{|\}\}/g, ""));
  const haystack = [
    profile.full_name, profile.handle, profile.bio ?? "",
    profile.category ?? "", ...(profile.postsSample ?? []),
  ].join(" ").toLowerCase();

  const matchedSignals: string[] = [];
  let score = 0;

  // Segment match (strongest signal)
  if (segments.some((s) => haystack.includes(s.toLowerCase()))) {
    score += 30;
    matchedSignals.push("segment_match");
  }
  // Keyword match
  if (keywords.some((k) => haystack.includes(k.toLowerCase()))) {
    score += 20;
    matchedSignals.push("keyword_match");
  }
  // Luxury positioning
  if (LUXURY_HINTS.test(haystack)) { score += 15; matchedSignals.push("luxury_signal"); }
  if (REAL_ESTATE_HINTS.test(haystack)) { score += 8; matchedSignals.push("real_estate_signal"); }
  if (JETSKI_HINTS.test(haystack)) { score += 8; matchedSignals.push("jetski_signal"); }

  // Account size band — luxury audiences are smaller; sweet spot 5k–300k
  const followers = profile.followers ?? 0;
  if (followers >= 5_000 && followers <= 300_000) { score += 12; matchedSignals.push("audience_band"); }
  else if (followers > 300_000) { score += 6; matchedSignals.push("large_audience"); }
  else if (followers >= 1_000) { score += 4; matchedSignals.push("small_audience"); }

  // Role detection
  let profile_type: LeadRecord["profile_type"] = "unknown";
  if (STORE_HINTS.test(haystack)) { profile_type = "store"; score += 10; matchedSignals.push("store_profile"); }
  if (OWNER_HINTS.test(haystack)) {
    profile_type = profile_type === "store" ? "decision_maker" : "owner";
    score += 15;
    matchedSignals.push("owner_signal");
  } else if (EMPLOYEE_HINTS.test(haystack)) {
    profile_type = "employee";
    score -= 10;
    matchedSignals.push("employee_signal");
  }

  // Geography — Brazil bonus when location present and matches
  if (profile.location && /brazil|brasil|br\b|s[ãa]o paulo|rio|florian[óo]polis|curitiba|porto alegre/i.test(profile.location)) {
    score += 8;
    matchedSignals.push("geo_br");
  }

  const finalScore = Math.max(0, Math.min(100, score));
  return {
    score: finalScore,
    priority: finalScore >= 70 ? 1 : finalScore >= 45 ? 2 : 3,
    profile_type,
    niche: detectNiche(haystack),
    matchedSignals,
  };
}

export function scoreAffiliateLead(profile: {
  full_name: string;
  handle: string;
  bio?: string | null;
  followers?: number;
  category?: string | null;
  postsSample?: string[];
}): ScoreResult {
  const business = safeBusiness();
  const topics = (business?.affiliates.topics ?? []).map((t) => t.replace(/\{\{|\}\}/g, ""));
  const haystack = [
    profile.full_name, profile.handle, profile.bio ?? "",
    profile.category ?? "", ...(profile.postsSample ?? []),
  ].join(" ").toLowerCase();

  const matchedSignals: string[] = [];
  let score = 0;

  if (topics.some((t) => haystack.includes(t.toLowerCase()))) {
    score += 30;
    matchedSignals.push("topic_match");
  }
  if (CREATOR_HINTS.test(haystack)) { score += 15; matchedSignals.push("creator_signal"); }

  // Engagement proxy: followers band + content signals
  const followers = profile.followers ?? 0;
  if (followers >= 10_000 && followers <= 150_000) { score += 20; matchedSignals.push("ideal_band"); }
  else if (followers > 150_000) { score += 10; matchedSignals.push("big_reach"); }
  else if (followers >= 3_000) { score += 8; matchedSignals.push("micro_influencer"); }

  if (LUXURY_HINTS.test(haystack)) { score += 10; matchedSignals.push("luxury_signal"); }

  let profile_type: LeadRecord["profile_type"] = "creator";
  if (!CREATOR_HINTS.test(haystack) && followers < 3_000) {
    profile_type = "unknown";
    score -= 15;
    matchedSignals.push("low_reach");
  }

  const finalScore = Math.max(0, Math.min(100, score));
  return {
    score: finalScore,
    priority: finalScore >= 65 ? 1 : finalScore >= 40 ? 2 : 3,
    profile_type,
    niche: detectNiche(haystack),
    matchedSignals,
  };
}

function detectNiche(haystack: string): string | null {
  if (REAL_ESTATE_HINTS.test(haystack)) return "real_estate_luxury";
  if (JETSKI_HINTS.test(haystack)) return "jetski_nautical";
  if (LUXURY_HINTS.test(haystack)) return "luxury_auto";
  return null;
}

function safeBusiness(): ReturnType<typeof getBusiness> | null {
  try {
    return getBusiness();
  } catch {
    return null;
  }
}

/** Best sending window: outside business rush, human-like. */
export function bestSendWindow(priority: 1 | 2 | 3): { hourStart: number; hourEnd: number } {
  if (priority === 1) return { hourStart: 9, hourEnd: 12 }; // morning attention
  if (priority === 2) return { hourStart: 13, hourEnd: 17 };
  return { hourStart: 17, hourEnd: 20 };
}
