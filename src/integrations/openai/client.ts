// ─── OpenAI integration: official SDK, exact models from .env, cost tracking ─
// OPENAI_MODEL for composition/decision, OPENAI_MODEL_FAST for classification.
// Every call records model, tokens and estimated cost in ai_calls.
// The worker checks OPENAI_MONTHLY_BUDGET_USD before each call.

import OpenAI from "openai";
import { getEnv, isOpenAiConfigured } from "@/config/env";
import { recordAiCall, monthlyAiSpend } from "@/db/messages";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!isOpenAiConfigured()) {
    throw new OpenAiNotConfiguredError("OPENAI_API_KEY missing — conversation engine paused");
  }
  if (!client) {
    // OpenAI official SDK; LLM_BASE_URL switches to OpenAI-compatible providers
    // (e.g. Google Gemini: https://generativelanguage.googleapis.com/v1beta/openai/)
    client = new OpenAI({
      apiKey: getEnv().OPENAI_API_KEY!,
      ...(getEnv().LLM_BASE_URL ? { baseURL: getEnv().LLM_BASE_URL } : {}),
    });
  }
  return client;
}

export class OpenAiNotConfiguredError extends Error {}

/** Rough cost estimate per model family (USD per 1M tokens). Gemini free tier = 0. */
function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  // Free-tier providers: zero marginal cost
  if (getEnv().LLM_BASE_URL?.includes("generativelanguage")) return 0;
  const table: Array<[RegExp, number, number]> = [
    [/gemini-2\.0-flash/, 0.10, 0.40],
    [/gemini-1\.5-flash/, 0.075, 0.30],
    [/gpt-4\.1-mini/, 0.40, 1.60],
    [/gpt-4\.1-nano/, 0.10, 0.40],
    [/gpt-4\.1/, 2.0, 8.0],
    [/gpt-4o-mini/, 0.15, 0.60],
    [/gpt-4o/, 2.5, 10.0],
  ];
  const entry = table.find(([re]) => re.test(model));
  if (!entry) return 0;
  return (tokensIn / 1e6) * entry[1] + (tokensOut / 1e6) * entry[2];
}

export interface CompletionResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model: string;
}

export async function complete(input: {
  purpose: string;
  leadId: string | null;
  model?: "main" | "fast";
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<CompletionResult> {
  const env = getEnv();
  const spent = monthlyAiSpend();
  if (spent >= env.OPENAI_MONTHLY_BUDGET_USD) {
    throw new BudgetExceededError(`monthly AI budget reached: US$${spent.toFixed(2)}`);
  }
  const model = input.model === "fast" ? env.OPENAI_MODEL_FAST : env.OPENAI_MODEL;
  const api = getClient();
  const res = await api.chat.completions.create({
    model,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    max_tokens: input.maxTokens ?? 300,
    temperature: input.temperature ?? 0.7,
  });
  const tokensIn = res.usage?.prompt_tokens ?? 0;
  const tokensOut = res.usage?.completion_tokens ?? 0;
  const costUsd = estimateCost(model, tokensIn, tokensOut);

  recordAiCall({
    lead_id: input.leadId,
    purpose: input.purpose,
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: costUsd,
  });

  return {
    text: res.choices[0]?.message?.content?.trim() ?? "",
    tokensIn,
    tokensOut,
    costUsd,
    model,
  };
}

export class BudgetExceededError extends Error {}

export function aiConfigured(): boolean {
  return isOpenAiConfigured();
}
