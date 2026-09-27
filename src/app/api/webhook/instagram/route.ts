// ─── Meta webhook route: GET (verify) + POST (messages) ─────────────────────
// GET: subscription handshake with INSTAGRAM_WEBHOOK_VERIFY_TOKEN.
// POST: signature check (X-Hub-Signature-256) → parse → channel handoff.
// Idempotent by message id (unique index) — Meta retries never duplicate.

import { NextRequest, NextResponse } from "next/server";
import { verifySubscriptionToken, verifyWebhookSignature, parseWebhookPayload } from "@/integrations/instagram/webhook";
import { processInboundMessage } from "@/features/conversations/handoff";
import { recordEvent } from "@/db";
import { isPaused } from "@/worker/safety";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");
  if (mode === "subscribe" && verifySubscriptionToken(token)) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(raw, signature)) {
    recordEvent("warn", "webhook_signature_rejected", {});
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const messages = parseWebhookPayload(payload);
  recordEvent("info", "webhook_received", { messages: messages.length });

  // Even when paused, record inbound messages (they are facts, not actions).
  // AI replies only happen when the system is operating.
  for (const msg of messages) {
    try {
      if (isPaused()) {
        recordEvent("warn", "webhook_message_while_paused", { igUserId: msg.igUserId });
        continue;
      }
      await processInboundMessage(msg);
    } catch (err) {
      recordEvent("error", "webhook_process_failed", {
        error: err instanceof Error ? err.message : String(err),
        messageId: msg.messageId,
      });
    }
  }

  // Always 200 to Meta (else it retries with backoff; we handle retries via idempotency)
  return NextResponse.json({ ok: true });
}
