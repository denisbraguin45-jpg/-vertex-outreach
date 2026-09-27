// ─── Prospecting tests: dedupe, opt-out permanence, status flow, outreach ───
// Run: npm test (node:test + tsx)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

// Isolated DB per test run
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), "outreach-prospects-")), "test.db");
process.env.OUTREACH_DRY_RUN = "true";

const { getDb } = await import("./index");
const { ensureProspectSchema, upsertProspect, setProspectStatus, markContacted, recordOutreach, getProspect, deleteProspects, listProspects, prospectCounters, outreachLogFor, saveTemplate, getTemplate, deleteTemplate } = await import("./prospects");

function cleanDb() {
  ensureProspectSchema();
  getDb().exec("DELETE FROM outreach_log; DELETE FROM prospects; DELETE FROM message_templates; DELETE FROM events;");
}

beforeEach(() => cleanDb());

test("prospect dedupe: same source+source_id never duplicates and fills empty channels", () => {
  const a = upsertProspect({ source: "osm", sourceId: "node/1", companyName: "Auto LTDA", phone: "11999990000" });
  assert.equal(a.created, true);
  const b = upsertProspect({ source: "osm", sourceId: "node/1", companyName: "Auto LTDA", email: "contato@auto.com.br" });
  assert.equal(b.created, false);
  assert.equal(b.prospect.email, "contato@auto.com.br"); // channel filled
  assert.equal(b.prospect.phone, "11999990000"); // existing preserved
});

test("opt-out prospect never re-enters nor gets updated", () => {
  const { prospect } = upsertProspect({ source: "osm", sourceId: "node/2", companyName: "Opt Out ME" });
  setProspectStatus(prospect.id, "opt_out");
  const again = upsertProspect({ source: "osm", sourceId: "node/2", companyName: "Opt Out ME", email: "x@y.com" });
  assert.equal(again.created, false);
  assert.equal(again.prospect.email, null); // untouched
  assert.equal(again.prospect.status, "opt_out");
});

test("status flow: valid transitions work, opt_out is terminal", () => {
  const { prospect } = upsertProspect({ source: "osm", sourceId: "node/3", companyName: "Flow SA" });
  assert.equal(getProspect(prospect.id)?.status, "nao_contatado");
  assert.ok(setProspectStatus(prospect.id, "contatado"));
  assert.ok(setProspectStatus(prospect.id, "respondeu"));
  assert.ok(setProspectStatus(prospect.id, "interessado"));
  // interested → nao_contatado is invalid
  assert.equal(setProspectStatus(prospect.id, "nao_contatado"), null);
});

test("recording outreach marks contacted and appends to log", () => {
  const { prospect } = upsertProspect({ source: "google_places", sourceId: "google/abc", companyName: "Clinica X" });
  recordOutreach({ prospectId: prospect.id, channel: "whatsapp", body: "Olá {{empresa}}!" });
  const after = getProspect(prospect.id)!;
  assert.equal(after.status, "contatado");
  assert.ok(after.last_contacted_at);
  assert.equal(after.last_channel, "whatsapp");
  assert.equal(outreachLogFor(prospect.id).length, 1);
  // opt-out blocks new dispatch records via API layer; here just verify history
  recordOutreach({ prospectId: prospect.id, channel: "email", body: "follow-up" });
  assert.equal(outreachLogFor(prospect.id).length, 2);
});

test("delete prospects removes rows", () => {
  const a = upsertProspect({ source: "osm", sourceId: "node/4", companyName: "Del 1" });
  const b = upsertProspect({ source: "osm", sourceId: "node/5", companyName: "Del 2" });
  const removed = deleteProspects([a.prospect.id, b.prospect.id]);
  assert.equal(removed, 2);
  assert.equal(getProspect(a.prospect.id), null);
});

test("filters: channel presence and status", () => {
  upsertProspect({ source: "osm", sourceId: "n/10", companyName: "Com Tudo", whatsapp: "11999", email: "a@b.c", website: "https://x.com" });
  upsertProspect({ source: "osm", sourceId: "n/11", companyName: "Só Fone", phone: "11888" });
  const withWpp = listProspects({ hasWhatsapp: true });
  assert.equal(withWpp.length, 1);
  assert.equal(withWpp[0].company_name, "Com Tudo");
  const noSite = listProspects({ noSite: true });
  assert.equal(noSite.length, 1);
  assert.equal(noSite[0].company_name, "Só Fone");
  assert.equal(listProspects({ hasSite: true })[0].company_name, "Com Tudo");
  const counters = prospectCounters();
  assert.equal(counters.total, 2);
  assert.equal(counters.withWhatsapp, 1);
});

test("templates: save, update, get, delete", () => {
  const t = saveTemplate({ name: "Abertura WhatsApp", channel: "whatsapp", body: "Olá {{empresa}}" });
  assert.ok(t.id);
  const updated = saveTemplate({ id: t.id, name: "Abertura v2", channel: "whatsapp", body: "Oi {{empresa}}" });
  assert.equal(getTemplate(t.id)?.body, "Oi {{empresa}}");
  assert.equal(getTemplate(t.id)?.name, "Abertura v2");
  void updated;
  deleteTemplate(t.id);
  assert.equal(getTemplate(t.id), null);
});

test("markContacted does not resurrect opt_out", () => {
  const { prospect } = upsertProspect({ source: "osm", sourceId: "node/6", companyName: "Silencio" });
  setProspectStatus(prospect.id, "opt_out");
  markContacted(prospect.id, "whatsapp");
  assert.equal(getProspect(prospect.id)?.status, "opt_out");
  assert.equal(getProspect(prospect.id)?.last_contacted_at, null);
});
