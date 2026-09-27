// ─── Handoff integration tests: browser → webhook → API + claims gate ──────

import { test, beforeEach } from "node:test";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), "outreach-handoff-")), "test.db");
process.env.OUTREACH_DRY_RUN = "true";
process.env.OUTREACH_AI_MODE = "simulated"; // deterministic, offline
process.env.OPENAI_API_KEY = ""; // proves the flow works without credentials

process.env.INSTAGRAM_APP_SECRET = "test-secret";

const { getDb } = await import("@/db");
const { upsertLead, transitionLead, getLead } = await import("@/db/leads");
const { appendMessage, channelOwner } = await import("@/db/messages");
const { processInboundMessage } = await import("@/features/conversations/handoff");
const { verifyWebhookSignature, parseWebhookPayload } = await import("@/integrations/instagram/webhook");

function clean() {
  getDb().exec("DELETE FROM messages; DELETE FROM leads; DELETE FROM events; DELETE FROM ai_calls;");
}

beforeEach(() => clean());

test("handoff: inbound moves channel from waiting_inbound_reply to api", async () => {
  const { lead } = upsertLead({ funnel: "clients", instagram_handle: "@handoff", full_name: "Handoff" });
  transitionLead(lead.id, "qualified", null, "score ok");
  transitionLead(lead.id, "contacted", "browser_contact_sent", "first dm");
  transitionLead(lead.id, null, "waiting_inbound_reply", "await");

  const res = await processInboundMessage({
    igUserId: "ig-123",
    username: "handoff",
    text: "me conta mais",
    messageId: `mid-${Date.now()}`,
    receivedAt: new Date(),
  });

  assert.equal(res.processed, true);
  const after = getLead(lead.id)!;
  // "me conta mais" → interest detected → pipeline advances past replied
  assert.ok(["replied", "interested"].includes(after.pipeline), `pipeline=${after.pipeline}`);
  assert.equal(after.channel, "api_active");
  assert.equal(channelOwner(lead.id), "api");
});

test("handoff: duplicate webhook delivery is ignored", async () => {
  const { lead } = upsertLead({ funnel: "clients", instagram_handle: "@dup", full_name: "Dup" });
  transitionLead(lead.id, "qualified", null, "score ok");
  transitionLead(lead.id, "contacted", "browser_contact_sent", "first dm");
  transitionLead(lead.id, null, "waiting_inbound_reply", "await");

  const msg = { igUserId: "ig-999", username: "dup", text: "oi", messageId: "mid-fixed-1", receivedAt: new Date() };
  const r1 = await processInboundMessage(msg);
  const r2 = await processInboundMessage(msg);
  assert.equal(r1.processed, true);
  assert.equal(r2.processed, false);
  assert.equal(r2.reason, "duplicate webhook delivery");
});

test("handoff: opt-out text sends lead to do_not_contact", async () => {
  const { lead } = upsertLead({ funnel: "clients", instagram_handle: "@stop", full_name: "Stop" });
  transitionLead(lead.id, "qualified", null, "score ok");
  transitionLead(lead.id, "contacted", "browser_contact_sent", "first dm");
  transitionLead(lead.id, null, "waiting_inbound_reply", "await");

  await processInboundMessage({
    igUserId: "ig-777",
    username: "stop",
    text: "por favor para de me chamar",
    messageId: `mid-${Date.now()}`,
    receivedAt: new Date(),
  });
  assert.equal(getLead(lead.id)?.channel, "do_not_contact");
});

test("webhook signature: rejects tampered payloads, accepts valid HMAC", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ entry: [] });
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(verifyWebhookSignature(body, sig), true);
  assert.equal(verifyWebhookSignature(body, "sha256=deadbeef"), false);
  assert.equal(verifyWebhookSignature(body, null), false);
});

test("webhook parse: echoes ignored, texts extracted", () => {
  const payload = {
    entry: [
      {
        id: "17841400000000000",
        messaging: [
          { sender: { id: "ig-a" }, recipient: { id: "me" }, timestamp: 1, message: { mid: "m1", text: "olá", is_echo: true } },
          { sender: { id: "ig-b" }, recipient: { id: "me" }, timestamp: 2, message: { mid: "m2", text: "tenho interesse" } },
        ],
      },
    ],
  };
  const msgs = parseWebhookPayload(payload);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].igUserId, "ig-b");
  assert.equal(msgs[0].text, "tenho interesse");
});
