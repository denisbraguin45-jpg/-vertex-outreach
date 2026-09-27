// ─── Instagram public discovery source ──────────────────────────────────────
// Reads only PUBLIC profile data (name, @, bio, category, follower count).
// Provider abstraction: "simulated" ships with realistic seed profiles so the
// whole system runs offline (tests/E2E); a real provider plugs the same
// interface later (official API fields or operator-supplied CSV import).

import { z } from "zod";

export interface PublicProfile {
  handle: string;
  full_name: string;
  bio: string | null;
  category: string | null;
  followers: number;
  location: string | null;
  user_id: string | null;
  postsSample: string[];
  relatedHandles: string[];
}

export interface DiscoveryProvider {
  readonly name: string;
  searchByKeywords(keywords: string[], limit: number): Promise<PublicProfile[]>;
  fetchProfile(handle: string): Promise<PublicProfile | null>;
}

// ─── Simulated provider (deterministic seeds for local runs/tests) ──────────

const SIMULATED: PublicProfile[] = [
  {
    handle: "autospremium.sp", full_name: "Autos Premium São Paulo",
    bio: "Concessionária de seminovos de luxo em SP · importados blindados · Porsche, BMW e Mercedes", category: "Car Dealership",
    followers: 48200, location: "São Paulo, Brazil", user_id: null,
    postsSample: ["Novo Porsche 911 chegando na loja", "Blindagem nível IIIA disponível"],
    relatedHandles: ["vendas.autospremium", "carlos.autospremium"],
  },
  {
    handle: "carlos.autospremium", full_name: "Carlos Mendes",
    bio: "Dono da @autospremium.sp | curtidor de supercarros e imports", category: "Entrepreneur",
    followers: 8400, location: "São Paulo, Brazil", user_id: null,
    postsSample: ["Nosso estoque de esportivos", "Garagem de luxo cheia hoje"],
    relatedHandles: ["autospremium.sp"],
  },
  {
    handle: "vendas.autospremium", full_name: "Marcos Vendas",
    bio: "Vendedor consultor na @autospremium.sp · atendimento premium", category: "Sales",
    followers: 2100, location: "São Paulo, Brazil", user_id: null,
    postsSample: ["Entrega do M4 hoje", "Chama no whats para condições"],
    relatedHandles: ["autospremium.sp"],
  },
  {
    handle: "riowatersports", full_name: "Rio Water Sports",
    bio: "Jetski e moto aquática no Rio · marina própria · Sea-Doo e Yamaha", category: "Boat Dealership",
    followers: 31500, location: "Rio de Janeiro, Brazil", user_id: null,
    postsSample: ["Passeio de jetski na Baía de Guanabara", "Estaleiro parceiro"],
    relatedHandles: ["ana.riowatersports"],
  },
  {
    handle: "ana.riowatersports", full_name: "Ana Ferreira",
    bio: "CEO @riowatersports · nautica e lifestyle", category: "CEO",
    followers: 12300, location: "Rio de Janeiro, Brazil", user_id: null,
    postsSample: ["Nossa frota de jetskis", "Marina cheia no fim de semana"],
    relatedHandles: ["riowatersports"],
  },
  {
    handle: "luxuryimoveis.rj", full_name: "Luxury Imóveis RJ",
    bio: "Imobiliária de luxo no Rio · coberturas e mansões alto padrão · CRECI 0000", category: "Real Estate",
    followers: 76500, location: "Rio de Janeiro, Brazil", user_id: null,
    postsSample: ["Cobertura triplex na Barra", "Lançamento alto padrão"],
    relatedHandles: ["paula.luxuryimoveis"],
  },
  {
    handle: "paula.luxuryimoveis", full_name: "Paula Rocha",
    bio: "Corretora CRECI | especialista em imóveis de luxo @luxuryimoveis.rj", category: "Real Estate Agent",
    followers: 26800, location: "Rio de Janeiro, Brazil", user_id: null,
    postsSample: ["Mansão em Itanhangá", "Alto padrão com vista mar"],
    relatedHandles: ["luxuryimoveis.rj"],
  },
  {
    handle: "jorgedoluxo", full_name: "Jorge do Luxo",
    bio: "Criador de conteúdo · imports e luxo · parcerias: jorge@luxo.com", category: "Creator",
    followers: 92000, location: "São Paulo, Brazil", user_id: null,
    postsSample: ["Testei a Ferrari do cliente", "Top 5 imports do ano"],
    relatedHandles: ["autospremium.sp"],
  },
  {
    handle: "mari.imports", full_name: "Mari Imports",
    bio: "Affiliate · cupons e achados de imports ✈️", category: "Digital creator",
    followers: 45000, location: "Curitiba, Brazil", user_id: null,
    postsSample: ["Link na bio com cupom", "Achadinhos importados"],
    relatedHandles: ["jorgedoluxo"],
  },
  {
    handle: "pizzaria.bairro", full_name: "Pizzaria do Bairro",
    bio: "A melhor pizza da região 🍕", category: "Restaurant",
    followers: 3200, location: "Santo André, Brazil", user_id: null,
    postsSample: ["Promoção de terça", "Pedido mínimo delivery"],
    relatedHandles: [],
  },
];

function match(haystack: string, term: string): boolean {
  return haystack.includes(term.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

function norm(p: PublicProfile): string {
  return [p.handle, p.full_name, p.bio ?? "", p.category ?? ""]
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export const simulatedProvider: DiscoveryProvider = {
  name: "simulated",
  async searchByKeywords(keywords: string[], limit: number): Promise<PublicProfile[]> {
    const results = SIMULATED.filter((p) => {
      const h = norm(p);
      return keywords.some((k) => match(h, k.replace(/\{\{|\}\}/g, "")));
    });
    return results.slice(0, limit);
  },
  async fetchProfile(handle: string): Promise<PublicProfile | null> {
    const clean = handle.toLowerCase().replace(/^@/, "");
    return SIMULATED.find((p) => p.handle === clean) ?? null;
  },
};

export function getDiscoveryProvider(): DiscoveryProvider {
  // Future: switch by env (official API/CSV import). Simulated keeps everything
  // runnable offline — the worker, CRM and conversation flow are identical.
  return simulatedProvider;
}

// Validation for operator CSV import (safe boundary for external data)
export const PublicProfileSchema = z.object({
  handle: z.string().min(1),
  full_name: z.string().min(1),
  bio: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  followers: z.number().int().nonnegative().default(0),
  location: z.string().nullable().optional(),
  user_id: z.string().nullable().optional(),
  postsSample: z.array(z.string()).default([]),
  relatedHandles: z.array(z.string()).default([]),
});
