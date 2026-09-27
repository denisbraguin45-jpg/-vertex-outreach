// ─── Discovery job: discover → dedupe → score → persist → queue contact ────

import { getBusiness } from "@/config/business";
import { getDiscoveryProvider, type PublicProfile } from "./instagram-public";
import { scoreClientLead, scoreAffiliateLead } from "./scoring";
import { upsertLead, transitionLead, funnelCounters } from "@/db/leads";
import { enqueueJob } from "@/db/jobs";
import { recordEvent } from "@/db/index";
import type { FunnelKind } from "@/db";

export interface DiscoveryResult {
  found: number;
  created: number;
  duplicates: number;
  highPriority: number;
  contactJobsQueued: number;
}

function placeholders(jsonValue: string): string[] {
  return [jsonValue.replace(/\{\{|\}\}/g, "")];
}

export async function runDiscoveryJob(funnel: FunnelKind): Promise<DiscoveryResult> {
  const business = getBusiness();
  const provider = getDiscoveryProvider();

  const keywords =
    funnel === "clients"
      ? [...business.icp.segments, ...business.icp.keywords, ...business.icp.geography]
          .flatMap((v) => placeholders(v).flatMap((s) => s.split(/\s*\|\s*/)))
          .filter(Boolean)
      : [...business.affiliates.topics, business.icp.geography].flatMap((v) => placeholders(v)).filter(Boolean);

  const found = await provider.searchByKeywords(keywords, 40);

  let created = 0;
  let duplicates = 0;
  let highPriority = 0;
  let contactJobsQueued = 0;

  for (const profile of found) {
    const scored =
      funnel === "clients"
        ? scoreClientLead(profile)
        : scoreAffiliateLead(profile);

    const { lead, created: isNew } = upsertLead({
      funnel,
      instagram_handle: profile.handle,
      instagram_user_id: profile.user_id,
      full_name: profile.full_name,
      profile_type: scored.profile_type,
      niche: scored.niche,
      segment: profile.category,
      bio: profile.bio,
      followers: profile.followers,
      location: profile.location,
      score: scored.score,
      priority: scored.priority,
      source_keyword: keywords.find((k) => profile.bio?.toLowerCase().includes(k.toLowerCase())) ?? null,
      tags: scored.matchedSignals,
    });

    if (isNew) created++;
    else duplicates++;

    if (scored.priority === 1) highPriority++;

    // Qualify high scores and queue first contact (browser funnel).
    if (lead.pipeline === "discovered" && lead.score >= 45) {
      const t = transitionLead(lead.id, "qualified", null, `score ${lead.score} >= 45`);
      if (t) {
        enqueueJob("first_contact", { leadId: lead.id, funnel });
        contactJobsQueued++;
      }
    }
  }

  recordEvent("info", "discovery_completed", { funnel, found: found.length, created, duplicates });
  return { found: found.length, created, duplicates, highPriority, contactJobsQueued };
}

/** Seeds related profiles discovered from a lead (perfulfil relacionado). */
export async function expandFromProfile(handle: string, funnel: FunnelKind): Promise<number> {
  const provider = getDiscoveryProvider();
  const profile = await provider.fetchProfile(handle);
  if (!profile) return 0;
  let added = 0;
  for (const related of profile.relatedHandles) {
    const rel = await provider.fetchProfile(related);
    if (!rel) continue;
    const scored = funnel === "clients" ? scoreClientLead(rel) : scoreAffiliateLead(rel);
    const { created } = upsertLead({
      funnel,
      instagram_handle: rel.handle,
      full_name: rel.full_name,
      bio: rel.bio,
      followers: rel.followers,
      score: scored.score,
      priority: scored.priority,
      profile_type: scored.profile_type,
      source_keyword: `related:${handle}`,
      tags: scored.matchedSignals,
    });
    if (created) added++;
  }
  return added;
}

export function discoverySnapshot() {
  const counters = funnelCounters();
  return counters;
}

export type { PublicProfile };
