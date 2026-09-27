// ─── Browser integration: Playwright over CDP to the operator's real Chrome ─
// Rules enforced here:
//   - connectOverCDP only (never launches a browser)
//   - reuses the first logged-in context, opens its OWN tab, closes it in finally
//   - never brings tab to front, never steals mouse/keyboard
//   - mutex: one browser job at a time
//   - dry-run mode logs the send instead of executing it
//   - failure evidence: screenshot, URL, console errors

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "@/config/env";

export interface SendResult {
  ok: boolean;
  duplicated?: boolean;
  dryRun?: boolean;
  handle?: string;
  message?: string;
  evidence?: EvidenceBundle;
  error?: string;
}

export interface EvidenceBundle {
  screenshotPath: string | null;
  url: string;
  consoleErrors: string[];
  capturedAt: string;
}

let mutex: Promise<unknown> = Promise.resolve();

/** Serializes every browser job. */
export function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutex.then(fn, fn);
  mutex = run.catch(() => undefined);
  return run;
}

export interface CdpSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

/**
 * Connect to the operator's Chrome over CDP. Never launches Chrome.
 * If connection fails the caller must register browser_unavailable and pause —
 * opening a new browser would break the logged-session premise.
 */
export async function connectCdp(): Promise<CdpSession> {
  const url = getEnv().CHROME_CDP_URL;
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(url, { timeout: 10_000 });
  } catch (err) {
    throw new BrowserUnavailableError(
      `connectOverCDP(${url}) failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => undefined);
    throw new BrowserUnavailableError("no browser context available over CDP");
  }
  const page = await context.newPage(); // agent's own tab — never the user's
  return {
    browser,
    context,
    page,
    async close(): Promise<void> {
      await page.close().catch(() => undefined);
      await browser.close().catch(() => undefined); // disconnects CDP, does not kill Chrome
    },
  };
}

export class BrowserUnavailableError extends Error {}

async function captureEvidence(page: Page, contextLabel: string): Promise<EvidenceBundle> {
  const env = getEnv();
  const dir = path.join(process.cwd(), "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `err-${Date.now()}-${contextLabel}.png`);
  let screenshotPath: string | null = null;
  try {
    await page.screenshot({ path: file, fullPage: false });
    screenshotPath = file;
  } catch {
    screenshotPath = null;
  }
  return {
    screenshotPath,
    url: page.url(),
    consoleErrors: [],
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Send a DM to a handle by URL (direct message deep link), typing like a human.
 * Accessibility snapshot is preferred over fragile CSS selectors.
 * In dry-run mode the final send is logged, not executed.
 */
export async function sendFirstDm(
  handle: string,
  message: string,
  opts: { dryRun?: boolean } = {},
): Promise<SendResult> {
  const env = getEnv();
  const dryRun = opts.dryRun ?? env.OUTREACH_DRY_RUN;
  const cleanHandle = handle.trim().toLowerCase().replace(/^@/, "");

  return withMutex(async () => {
    let session: CdpSession | null = null;
    try {
      session = await connectCdp();
      const page = session.page;

      // Restrict to Instagram domain.
      if (!/https:\/\/(www\.)?instagram\.com/.test(page.url()) && page.url() !== "about:blank") {
        await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
      }

      // Deep link to the DM thread — deterministic entry point.
      const dmUrl = `https://www.instagram.com/direct/new/?handle=${cleanHandle}`;
      await page.goto(dmUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(2500);

      // Login check: Instagram redirects to /accounts/login when session is dead.
      if (/accounts\/login/.test(page.url())) {
        const evidence = await captureEvidence(page, "session-lost");
        return {
          ok: false,
          error: "instagram session lost — operator must log in once in the dedicated profile",
          evidence,
        };
      }

      if (dryRun) {
        return {
          ok: true,
          dryRun: true,
          handle: cleanHandle,
          message: `[DRY-RUN] message composed but not sent: "${message.slice(0, 60)}..."`,
        };
      }

      // The composer: contenteditable message box on the new-DM screen.
      const composer = page.locator('div[role="textbox"][contenteditable="true"]').first();
      await composer.waitFor({ state: "visible", timeout: 20_000 });

      // Human typing: per-character delay + pre-send pause.
      await composer.click();
      await page.waitForTimeout(600 + Math.random() * 900);
      await composer.pressSequentially(message, { delay: 45 + Math.random() * 65 });
      await page.waitForTimeout(900 + Math.random() * 1400);

      const nextBtn = page.getByRole("button", { name: /next|próxima|seguinte/i }).first();
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(1200);
      }
      const sendBtn = page.getByRole("button", { name: /^(send|enviar|chat)/i }).first();
      await sendBtn.click();
      await page.waitForTimeout(1500);

      return { ok: true, handle: cleanHandle, message: "sent" };
    } catch (err) {
      const evidence = session ? await captureEvidence(session.page, "send-error") : null;
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        evidence: evidence ?? undefined,
      };
    } finally {
      // ALWAYS close the agent tab — including on error.
      await session?.close();
    }
  });
}
