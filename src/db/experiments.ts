// ─── Experiments: one variable at a time, controlled distribution ───────────
// Guardrails: no early winner declaration (min sample), gradual rollout of the
// champion (handled by weights), and a share always exploring new hypotheses.

import { getDb, nowISO, newId } from "./index";
import { asRow, asRows } from "./rows";
import type { ExperimentRecord } from "./index";

export interface VariantStat {
  key: string;
  weight: number;
  count: number;
  conversions: number;
}

export function createExperiment(input: {
  name: string;
  hypothesis: string;
  variable: string;
  variants: Array<{ key: string; weight?: number }>;
  minSamplePerVariant?: number;
}): ExperimentRecord {
  const id = newId();
  getDb()
    .prepare(
      "INSERT INTO experiments (id, name, hypothesis, variable, status, variants_json, min_sample_per_variant, created_at) VALUES (?, ?, ?, ?, 'running', ?, ?, ?)",
    )
    .run(
      id, input.name, input.hypothesis, input.variable,
      JSON.stringify(input.variants.map((v, i) => ({ key: v.key, weight: v.weight ?? 1 / input.variants.length, count: 0, conversions: 0 }))),
      input.minSamplePerVariant ?? 50, nowISO(),
    );
  return getExperiment(id)!;
}

export function getExperiment(id: string): ExperimentRecord | null {
  return asRow<ExperimentRecord>(getDb().prepare("SELECT * FROM experiments WHERE id = ?").get(id));
}

export function listExperiments(status?: ExperimentRecord["status"]): ExperimentRecord[] {
  if (status) {
    return asRows<ExperimentRecord>(
      getDb().prepare("SELECT * FROM experiments WHERE status = ? ORDER BY created_at DESC").all(status),
    );
  }
  return asRows<ExperimentRecord>(
    getDb().prepare("SELECT * FROM experiments ORDER BY created_at DESC LIMIT 100").all(),
  );
}

/**
 * Deterministic assignment: hash(leadId + variable) maps to a variant by
 * cumulative weight. Same lead always gets the same variant (comparability),
 * weights allow gradual champion rollout.
 */
export function assignVariant(experimentId: string, leadId: string): string {
  const exp = getExperiment(experimentId);
  if (!exp || exp.status !== "running") return "control";
  const variants = JSON.parse(exp.variants_json) as VariantStat[];
  if (variants.length === 0) return "control";

  const hash = hashString(`${leadId}:${exp.variable}`);
  const point = (hash % 10_000) / 10_000;
  let acc = 0;
  for (const v of variants) {
    acc += v.weight;
    if (point < acc) {
      v.count += 1;
      getDb().prepare("UPDATE experiments SET variants_json = ? WHERE id = ?").run(JSON.stringify(variants), experimentId);
      return v.key;
    }
  }
  return variants[0].key;
}

export function recordConversion(experimentId: string, variantKey: string): void {
  const exp = getExperiment(experimentId);
  if (!exp) return;
  const variants = JSON.parse(exp.variants_json) as VariantStat[];
  const v = variants.find((x) => x.key === variantKey);
  if (!v) return;
  v.conversions += 1;
  getDb().prepare("UPDATE experiments SET variants_json = ? WHERE id = ?").run(JSON.stringify(variants), experimentId);
}

export interface VariantResult {
  key: string;
  count: number;
  conversions: number;
  rate: number;
}

export interface ExperimentVerdict {
  experiment: ExperimentRecord;
  results: VariantResult[];
  winner: string | null;
  ready: boolean;
}

/**
 * Verdict only when every variant reached min sample. No early winners.
 */
export function verdict(experimentId: string): ExperimentVerdict | null {
  const exp = getExperiment(experimentId);
  if (!exp) return null;
  const variants = JSON.parse(exp.variants_json) as VariantStat[];
  const results: VariantResult[] = variants.map((v) => ({
    key: v.key,
    count: v.count,
    conversions: v.conversions,
    rate: v.count > 0 ? v.conversions / v.count : 0,
  }));
  const ready = results.every((r) => r.count >= exp.min_sample_per_variant);
  let winner: string | null = null;
  if (ready && results.length >= 2) {
    const sorted = [...results].sort((a, b) => b.rate - a.rate);
    // require a clear margin to avoid noise-driven decisions
    if (sorted[0].rate > sorted[1].rate * 1.15) winner = sorted[0].key;
  }
  return { experiment: exp, results, winner, ready };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
