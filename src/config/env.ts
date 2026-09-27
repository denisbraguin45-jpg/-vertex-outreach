// ─── Environment validation (server-only) ───────────────────────────────────
// Fails fast on boot when required variables are missing or malformed.
// The system degrades gracefully: without OpenAI key the worker runs discovery
// and queues jobs but pauses conversation generation with a clear reason.

export interface OutreachEnv {
  OPENAI_API_KEY: string | null;
  /** Optional OpenAI-compatible base URL (e.g. Gemini: https://generativelanguage.googleapis.com/v1beta/openai/) */
  LLM_BASE_URL: string | null;
  OPENAI_MODEL: string;
  OPENAI_MODEL_FAST: string;
  OPENAI_MONTHLY_BUDGET_USD: number;
  CHROME_CDP_URL: string;
  CHROME_PROFILE_DIR: string;
  INSTAGRAM_APP_SECRET: string | null;
  INSTAGRAM_PAGE_ACCESS_TOKEN: string | null;
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: string | null;
  INSTAGRAM_BUSINESS_ACCOUNT_ID: string | null;
  DATABASE_URL: string;
  MAX_DMS_PER_DAY: number;
  MIN_SECONDS_BETWEEN_DMS: number;
  MAX_SECONDS_BETWEEN_DMS: number;
  OPERATING_HOURS: { start: string; end: string };
  OPERATING_TIMEZONE: string;
  OUTREACH_DRY_RUN: boolean;
  /** Simulated API send (no Meta credentials needed) — default true. */
  OUTREACH_AI_SIMULATE_API: boolean;
}

function parseHours(raw: string | undefined): { start: string; end: string } {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(raw ?? "09:00-20:00");
  if (!m) return { start: "09:00", end: "20:00" };
  return { start: `${m[1].padStart(2, "0")}:${m[2]}`, end: `${m[3].padStart(2, "0")}:${m[4]}` };
}

let cached: OutreachEnv | null = null;

export function getEnv(): OutreachEnv {
  if (cached) return cached;
  cached = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
    LLM_BASE_URL: process.env.LLM_BASE_URL || null,
    OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    OPENAI_MODEL_FAST: process.env.OPENAI_MODEL_FAST || "gpt-4.1-nano",
    OPENAI_MONTHLY_BUDGET_USD: Number(process.env.OPENAI_MONTHLY_BUDGET_USD || 50),
    CHROME_CDP_URL: process.env.CHROME_CDP_URL || "http://127.0.0.1:9222",
    CHROME_PROFILE_DIR: process.env.CHROME_PROFILE_DIR || "./.chrome-profile",
    INSTAGRAM_APP_SECRET: process.env.INSTAGRAM_APP_SECRET || null,
    INSTAGRAM_PAGE_ACCESS_TOKEN: process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || null,
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || null,
    INSTAGRAM_BUSINESS_ACCOUNT_ID: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || null,
    DATABASE_URL: process.env.DATABASE_URL || "./data/outreach.db",
    MAX_DMS_PER_DAY: Number(process.env.MAX_DMS_PER_DAY || 30),
    MIN_SECONDS_BETWEEN_DMS: Number(process.env.MIN_SECONDS_BETWEEN_DMS || 90),
    MAX_SECONDS_BETWEEN_DMS: Number(process.env.MAX_SECONDS_BETWEEN_DMS || 240),
    OPERATING_HOURS: parseHours(process.env.OPERATING_HOURS),
    OPERATING_TIMEZONE: process.env.OPERATING_TIMEZONE || "America/Sao_Paulo",
    OUTREACH_DRY_RUN: /^(1|true|yes)$/i.test(process.env.OUTREACH_DRY_RUN || ""),
    OUTREACH_AI_SIMULATE_API: !/^(0|false|no)$/i.test(process.env.OUTREACH_AI_SIMULATE_API ?? ""),
  };
  return cached;
}

export function isOpenAiConfigured(): boolean {
  return Boolean(getEnv().OPENAI_API_KEY);
}

export function isInstagramApiConfigured(): boolean {
  const e = getEnv();
  return Boolean(e.INSTAGRAM_PAGE_ACCESS_TOKEN && e.INSTAGRAM_BUSINESS_ACCOUNT_ID);
}
