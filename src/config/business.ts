// ─── Business configuration (server-only) ────────────────────────────────────
// Loaded from config/business.json (gitignored). VERIFIED_CLAIMS is the only
// source of commercial statements the AI may send. Never import from client code.

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const BusinessSchema = z.object({
  owner: z.object({ name: z.string().min(1), role: z.string().min(1) }),
  company: z.object({
    name: z.string().min(1),
    website: z.string(),
    instagram: z.string().optional(),
    oneLinePitch: z.string(),
    revenueModel: z.string(),
    howItWorks: z.array(z.string()).default([]),
    marketJargon: z.string().optional(),
  }),
  channels: z.object({
    whatsappLink: z.string(),
    affiliateGroupLink: z.string(),
  }),
  icp: z.object({
    segments: z.array(z.string()),
    keywords: z.array(z.string()),
    geography: z.string(),
  }),
  affiliates: z.object({
    topics: z.array(z.string()),
    scoringNotes: z.string().optional(),
  }),
  claims: z.object({
    verified: z.array(z.string()),
    unverified: z.array(z.string()),
  }),
});

export type BusinessConfig = z.infer<typeof BusinessSchema>;

const CONFIG_PATH = path.join(process.cwd(), "config", "business.json");

let cached: BusinessConfig | null = null;

export function getBusiness(): BusinessConfig {
  if (cached) return cached;
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      "config/business.json not found. Copy config/business.example.json and fill the placeholders.",
    );
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as unknown;
  const parsed = BusinessSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid config/business.json: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}

/** Claims the AI is allowed to state. Only these. No paraphrase outside. */
export function verifiedClaims(): string[] {
  return getBusiness().claims.verified.filter((c) => !c.includes("{{"));
}

/** Claims hard-blocked until proven. The AI must never send these. */
export function unverifiedClaims(): string[] {
  return getBusiness().claims.unverified.filter((c) => !c.includes("{{"));
}

/**
 * Gate: returns the claim if verified, otherwise throws.
 * The conversation engine calls this before including any commercial claim.
 */
export function assertVerifiedClaim(claim: string): string {
  const normalized = claim.trim().toLowerCase();
  const found = verifiedClaims().find((c) => c.trim().toLowerCase() === normalized);
  if (!found) {
    throw new Error(`Blocked claim (not in VERIFIED_CLAIMS): "${claim.slice(0, 80)}"`);
  }
  return found;
}
