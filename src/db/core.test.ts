// ─── Critical flow tests: dedupe, transitions, idempotency, channel lock ────
// Run: pnpm test  (node:test + tsx)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

// Isolated DB per test run
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), "outreach-test-")), "test.db");
process.env.OUTREACH_DRY_RUN = "true";

const { getDb, newId } = await import("./index");
const { upsertLead, transitionLead, markDoNotContact, getLead } = await import("./leads");
const { appendMessage, canSendVia, channelOwner } = await import("./messages");
const { enqueueJob, claimNextJob, completeJob, failJob, recoverStaleJobs, getJob } = await import("./jobs");
const { assignVariant, recordConversion, verdict } = await import("./experiments");

function cleanDb() {
  const d = getDb();
  d.exec("DELETE FROM messages; DELETE FROM leads; DELETE FROM jobs; DELETE FROM experiments; DELETE FROM events; DELETE FROM ai_calls;");
}

beforeEach(() => cleanDb());

test("lead dedupe: same funnel+handle never duplicates", () => {
  const a = upsertLead({ funnel: "clients", instagram_handle: "@LojaLuxo", full_name: "Loja Luxo", score: 60 });
  const b = upsertLead({ funnel: "clients", instagram_handle: "lojaluxo", full_name: "Loja Luxo Atualizada", score: 75 });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.lead.id, b.lead.id);
  assert.equal(b.lead.score, 75); // discovery data refreshed
});

test("lead dedupe: same handle in different funnels coexist", () => {
  const a = upsertLead({ funnel: "clients", instagram_handle: "@perfil", full_name: "Perfil" });
  const b = upsertLead({ funnel: "affiliates", instagram_handle: "@perfil", full_name: "Perfil" });
  assert.notEqual(a.lead.id, b.lead.id);
});

test("pipeline transitions are validated (no jumps)", () => {
  const { lead } = upsertLead({ funnel: "clients", instagram_handle: "@t1", full_name: "T1" });
  // discovered → replied is invalid
  const bad = transitionLead(lead.id, "replied", null, "invalid jump");
  assert.equal(bad, null);
  // discovered → qualified is valid
  const ok = transitionLead(lead.id, "qualified", null, "valid");
  assert.equal(ok?.pipeline, "qualified");
});

test("channel transitions follow the flow", () => {
  const { lead } = upsertLead({ funnel: "clients", instagram_handle: "@t2", full_name: "T2" });
  assert.equal(lead.channel, "browser_contact_pending");
  // pipeline must walk: discovered → qualified → contacted
  transitionLead(lead.id, "qualified", null, "score ok");
  const sent = transitionLead(lead.id, "contacted", "browser_contact_sent", "dm sent");
  assert.equal(sent?.channel, "browser_contact_sent");
  // browser_contact_sent → api_active directly is invalid
  const bad = transitionLead(lead.id, null, "api_active", "invalid");
  assert.equal(bad, null);
});

test("do_not_contact is permanent: no transitions, no re-entry", () => {
  const { lead } = upsertLead({ funnel: "clients", instagram_handle: "@dnc", full_name: "DNC" });
  markDoNotContact(lead.id, "test opt-out");
  const blocked = transitionLead(lead.id, "qualified", null, "attempt after opt-out");
  assert.equal(blocked, null);
  // upsert does not resurrect
  const again = upsertLead({ funnel: "clients", instagram_handle: "@dnc", full_name: "DNC" });
  assert.equal(again.created, false);
  assert.equal(getLead(lead.id)?.channel, "do_not_contact");
});

test("webhook idempotency: same meta_message_id processed once", () => {
  const { lead } = upsertLead({ funnel: "clients", instagram_handle: "@idem", full_name: "Idem" });
  const first = appendMessage({ lead_id: lead.id, direction: "inbound", channel: "api", body: "oi", meta_message_id: "mid-123" });
  const second = appendMessage({ lead_id: lead.id, direction: "inbound", channel: "api", body: "oi", meta_message_id: "mid-123" });
  assert.equal(first.duplicated, false);
  assert.equal(second.duplicated, true);
  assert.equal(first.message.id, second.message.id);
});

test("channel ownership lock: browser owns until inbound arrives", () => {
  const { lead } = upsertLead({ funnel: "clients", instagram_handle: "@lock", full_name: "Lock" });
  // no messages yet: first contact must be browser
  assert.equal(canSendVia(lead.id, "browser"), true);
  assert.equal(canSendVia(lead.id, "api"), false);

  appendMessage({ lead_id: lead.id, direction: "outbound", channel: "browser", body: "primeira DM" });
  assert.equal(channelOwner(lead.id), "browser");
  assert.equal(canSendVia(lead.id, "api"), false); // API cannot send before reply

  appendMessage({ lead_id: lead.id, direction: "inbound", channel: "api", body: "opa, tudo bem?", meta_message_id: `mid-${newId()}` });
  assert.equal(channelOwner(lead.id), "api");
  assert.equal(canSendVia(lead.id, "api"), true);
  assert.equal(canSendVia(lead.id, "browser"), false); // browser must not touch the thread
});

test("jobs: claim is atomic, retry with backoff, dead-letter after max", async () => {
  enqueueJob("test_kind", { x: 1 });
  const job = claimNextJob();
  assert.ok(job);
  assert.equal(job.status, "running");
  assert.equal(claimNextJob(), null); // nothing else due

  completeJob(job.id);
  const done = claimNextJob();
  assert.equal(done, null);

  // retry path — wait so run_at backoff doesn't hide the requeued job
  enqueueJob("test_kind", {}, { maxAttempts: 2, runAt: new Date(Date.now() - 1000) });
  const j1 = claimNextJob()!;
  failJob(j1.id, "boom");
  const j1b = getJobRow(j1.id)!;
  assert.equal(j1b.status, "queued"); // requeued

  // backoff scheduled it 60s out; pull it back for the test
  getDb().prepare("UPDATE jobs SET run_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), j1.id);
  const j2 = claimNextJob()!;
  failJob(j2.id, "boom again");
  const j2b = getJobRow(j2.id)!;
  assert.equal(j2b.status, "dead"); // exhausted
});

test("recovery: stale running jobs are requeued", () => {
  enqueueJob("test_kind", {});
  const job = claimNextJob()!;
  // simulate stale started_at
  getDb().prepare("UPDATE jobs SET started_at = ? WHERE id = ?").run(new Date(Date.now() - 3600_000).toISOString(), job.id);
  const n = recoverStaleJobs(15);
  assert.equal(n, 1);
  const row = getJobRow(job.id)!;
  assert.equal(row.status, "queued");
});

test("experiments: deterministic assignment and guarded verdict", () => {
  const exp = createExperimentFn({
    name: "test",
    hypothesis: "h",
    variable: "opening_variant",
    variants: [{ key: "a" }, { key: "b" }],
    minSamplePerVariant: 5,
  });
  // deterministic: same lead → same variant
  const v1 = assignVariant(exp.id, "lead-1");
  const v2 = assignVariant(exp.id, "lead-1");
  assert.equal(v1, v2);

  // verdict not ready before min sample
  recordConversion(exp.id, "a");
  const early = verdict(exp.id);
  assert.equal(early?.ready, false);

  // fill samples
  for (let i = 0; i < 5; i++) assignVariant(exp.id, `lead-a-${i}`);
  for (let i = 0; i < 5; i++) assignVariant(exp.id, `lead-b-${i}`);
  recordConversion(exp.id, "a");
  recordConversion(exp.id, "a");
  recordConversion(exp.id, "a");
  const v = verdict(exp.id);
  assert.equal(v?.ready, true);
  assert.equal(v?.winner, "a"); // 60% vs 0% — clear margin
});

// helpers (bound imports for use inside tests)
import { createExperiment as createExperimentFn } from "./experiments";
const getJobRow = getJob;
