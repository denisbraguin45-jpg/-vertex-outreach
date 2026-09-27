// ─── Scraper multicanal: Nominatim + Overpass (OSM grátis) + Google Places ──
// Fontes públicas e permitidas, respeitando rate limits. Coleta apenas dados
// públicos mapeados — sem contornar autenticação, limites ou políticas.
// IMPORTANTE: sem qualificação comercial. Toda empresa entra na base — a
// triagem é feita depois pelo operador.

// ─── Geocodificação (Nominatim + centros de UF) ──────────────────────────────

export interface GeoResult {
  name: string;
  state: string;
  lat: number;
  lon: number;
  bbox: [number, number, number, number]; // south, north, west, east
}

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const NOMINATIM_UA = "VertexOutreach/0.1 (prospeccao multicanal)";

const geoCache = new Map<string, { at: number; value: GeoResult | null }>();
const GEO_TTL = 24 * 60 * 60 * 1000;
let lastGeoCall = 0;

async function throttleGeo(): Promise<void> {
  const elapsed = Date.now() - lastGeoCall;
  if (elapsed < 1100) await new Promise((r) => setTimeout(r, 1100 - elapsed));
  lastGeoCall = Date.now();
}

export async function geocodeCity(city: string, state?: string): Promise<GeoResult | null> {
  const key = `city|${city}|${state ?? ""}`.toLowerCase();
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < GEO_TTL) return hit.value;
  await throttleGeo();
  const query = state ? `${city}, ${state}, Brasil` : `${city}, Brasil`;
  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&countrycodes=br`;
  const res = await fetch(url, {
    headers: { "User-Agent": NOMINATIM_UA, "Accept-Language": "pt-BR,pt;q=0.9" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = (await res.json()) as Array<{ name: string; display_name: string; lat: string; lon: string; boundingbox: string[] }>;
  const first = data[0] ?? null;
  const value: GeoResult | null = first
    ? {
        name: first.name || city,
        state: state ?? (first.display_name.split(",")[1] ?? "").trim(),
        lat: parseFloat(first.lat),
        lon: parseFloat(first.lon),
        bbox: first.boundingbox.map(Number) as [number, number, number, number],
      }
    : null;
  geoCache.set(key, { at: Date.now(), value });
  return value;
}

// Centros aproximados das UFs — evita chamadas ao Nominatim p/ estado
const UF_CENTERS: Record<string, { lat: number; lon: number; name: string }> = {
  SP: { lat: -22.19, lon: -48.79, name: "São Paulo" },
  RJ: { lat: -22.25, lon: -42.66, name: "Rio de Janeiro" },
  MG: { lat: -18.52, lon: -44.55, name: "Minas Gerais" },
  ES: { lat: -19.57, lon: -40.65, name: "Espírito Santo" },
  PR: { lat: -24.62, lon: -51.34, name: "Paraná" },
  SC: { lat: -27.33, lon: -50.53, name: "Santa Catarina" },
  RS: { lat: -29.68, lon: -53.49, name: "Rio Grande do Sul" },
  BA: { lat: -12.47, lon: -41.7, name: "Bahia" },
  PE: { lat: -8.38, lon: -37.86, name: "Pernambuco" },
  CE: { lat: -5.2, lon: -39.53, name: "Ceará" },
  GO: { lat: -15.94, lon: -49.64, name: "Goiás" },
  DF: { lat: -15.78, lon: -47.93, name: "Distrito Federal" },
  MT: { lat: -12.96, lon: -55.92, name: "Mato Grosso" },
  MS: { lat: -20.51, lon: -54.54, name: "Mato Grosso do Sul" },
  PA: { lat: -5.53, lon: -52.29, name: "Pará" },
  AM: { lat: -3.47, lon: -62.22, name: "Amazonas" },
  MA: { lat: -5.42, lon: -45.06, name: "Maranhão" },
  PI: { lat: -7.65, lon: -42.56, name: "Piauí" },
  RN: { lat: -5.81, lon: -36.59, name: "Rio Grande do Norte" },
  PB: { lat: -7.28, lon: -36.68, name: "Paraíba" },
  AL: { lat: -9.62, lon: -36.82, name: "Alagoas" },
  SE: { lat: -10.57, lon: -37.39, name: "Sergipe" },
  TO: { lat: -10.17, lon: -48.3, name: "Tocantins" },
  RO: { lat: -11.51, lon: -62.77, name: "Rondônia" },
  AC: { lat: -9.02, lon: -70.55, name: "Acre" },
  AP: { lat: -1.41, lon: -51.92, name: "Amapá" },
  RR: { lat: -2.05, lon: -61.4, name: "Roraima" },
};

export async function geocodeState(uf: string): Promise<GeoResult | null> {
  const key = `state|${uf}`.toLowerCase();
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < GEO_TTL) return hit.value;
  const center = UF_CENTERS[uf.toUpperCase()];
  const value: GeoResult | null = center
    ? {
        name: center.name,
        state: center.name,
        lat: center.lat,
        lon: center.lon,
        bbox: [center.lat - 2.5, center.lat + 2.5, center.lon - 2.5, center.lon + 2.5],
      }
    : null;
  geoCache.set(key, { at: Date.now(), value });
  return value;
}

const REGION_UFS: Record<string, string[]> = {
  sul: ["PR", "SC", "RS"],
  sudeste: ["SP", "RJ", "MG", "ES"],
  centro_oeste: ["GO", "DF", "MT", "MS"],
  nordeste: ["BA", "PE", "CE", "RN", "PB", "AL", "SE", "PI", "MA"],
  norte: ["PA", "AM", "TO", "RO", "AC", "AP", "RR"],
  brasil: Object.keys(UF_CENTERS),
};

export function ufsForRegion(region?: string): string[] {
  if (!region) return ["SP"];
  return REGION_UFS[region.toLowerCase()] ?? [region.toUpperCase()];
}

// ─── Overpass (OSM): descoberta de empresas por tags/nome ────────────────────

export interface OsmPlace {
  osmType: "node" | "way" | "relation";
  osmId: number;
  name: string;
  tags: Record<string, string>;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const OVERPASS_UA = "VertexOutreach/0.1 (prospeccao multicanal)";

let lastOverpass = 0;
async function throttleOverpass(): Promise<void> {
  const minGap = 2000;
  const elapsed = Date.now() - lastOverpass;
  if (elapsed < minGap) await new Promise((r) => setTimeout(r, minGap - elapsed));
  lastOverpass = Date.now();
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
}

async function runOverpassQuery(query: string, timeoutMs = 60_000): Promise<OverpassElement[]> {
  await throttleOverpass();
  let lastError: Error | null = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": OVERPASS_UA },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status === 504 || res.status === 502 || res.status === 503) {
        lastError = new Error(`Overpass HTTP ${res.status} em ${endpoint}`);
        continue;
      }
      if (!res.ok) {
        lastError = new Error(`Overpass HTTP ${res.status} em ${endpoint}`);
        continue;
      }
      const data = (await res.json()) as { elements?: OverpassElement[] };
      return data.elements ?? [];
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error("Overpass indisponível (todos os endpoints falharam)");
}

function toOsmPlaces(elements: OverpassElement[], maxElements: number): OsmPlace[] {
  return elements
    .filter((e) => e.tags && e.tags.name)
    .slice(0, maxElements)
    .map((e) => ({
      osmType: e.type as OsmPlace["osmType"],
      osmId: e.id,
      name: e.tags!.name,
      tags: e.tags ?? {},
    }));
}

/** Busca POIs por tags OSM dentro de um bbox. */
export async function searchOsmByTags(
  filters: string[],
  bbox: [number, number, number, number],
  maxElements = 800,
): Promise<OsmPlace[]> {
  const [south, north, west, east] = bbox;
  const bb = `${south},${west},${north},${east}`;
  const union = filters
    .map((f) => {
      const [k, v] = f.split("=");
      return v ? `nwr["${k}"="${v}"](${bb});` : `nwr["${k}"](${bb});`;
    })
    .join("\n  ");
  const query = `[out:json][timeout:60];\n(\n  ${union}\n);\nout center ${maxElements};\n`;
  return toOsmPlaces(await runOverpassQuery(query, 90_000), maxElements);
}

/** Fallback por nome (regex, case-insensitive) — cobre empresas mal-tagadas. */
export async function searchOsmByName(
  regex: string,
  bbox: [number, number, number, number],
  maxElements = 800,
): Promise<OsmPlace[]> {
  const [south, north, west, east] = bbox;
  const bb = `${south},${west},${north},${east}`;
  const safe = regex.replace(/\(\?i\)/g, "").replace(/["\\]/g, "");
  const nq = `nwr["name"~"${safe}",i](${bb})`;
  const query = `[out:json][timeout:90];\n(\n  ${nq}["shop"];\n  ${nq}["office"];\n  ${nq}["craft"];\n  ${nq}["healthcare"];\n  ${nq}["amenity"~"clinic|coworking_space|pharmacy|veterinary|restaurant|cafe"];\n)\nout center ${maxElements};\n`;
  return toOsmPlaces(await runOverpassQuery(query, 120_000), maxElements);
}

/** Converte um POI OSM em draft de prospect (fonte: osm). */
export function osmToProspectDraft(place: OsmPlace): ProspectDraft {
  const t = place.tags;
  const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", ");
  const phoneRaw = t.phone ?? t["contact:phone"] ?? t["contact:mobile"] ?? null;
  const whatsappRaw = t["contact:whatsapp"] ?? t["contact:mobile"] ?? null;
  const categoryTag = Object.entries(t).find(([k]) =>
    ["shop", "office", "craft", "amenity", "healthcare", "leisure"].includes(k),
  );
  return {
    source: "osm",
    sourceId: `${place.osmType}/${place.osmId}`,
    companyName: place.name,
    category: categoryTag ? categoryTag[1] : null,
    phone: phoneRaw,
    whatsapp: whatsappRaw,
    email: t["contact:email"] ?? t.email ?? null,
    instagram: t["contact:instagram"] ?? null,
    website: t.website ?? t["contact:website"] ?? null,
    address: street ? `${street}${t["addr:postcode"] ? ` - CEP ${t["addr:postcode"]}` : ""}` : null,
    city: t["addr:city"] ?? null,
    state: t["addr:state"] ?? null,
    googleMapsUrl: t["contact:map"] ?? null,
    googleRating: null,
    googleReviewsCount: null,
  };
}

// ─── Google Places (opcional; enriquece avaliação/maps/canais) ───────────────

const PLACES_BASE = "https://places.googleapis.com/v1/places:searchText";

export function placesEnabled(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

interface PlacesResult {
  id: string;
  displayName: string;
  formattedAddress: string | null;
  rating: number | null;
  userRatingCount: number | null;
  websiteUri: string | null;
  nationalPhoneNumber: string | null;
  internationalPhoneNumber: string | null;
  googleMapsUri: string | null;
  primaryTypeDisplayName: string | null;
}

export async function placesTextSearch(
  query: string,
  opts: { city?: string; maxResults?: number } = {},
): Promise<{ results: PlacesResult[]; nextPageToken?: string }> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY não configurada");
  const body: Record<string, unknown> = {
    textQuery: opts.city ? `${query} em ${opts.city}` : `${query} Brasil`,
    maxResultCount: Math.min(opts.maxResults ?? 20, 20),
    languageCode: "pt-BR",
    regionCode: "BR",
  };
  const res = await fetch(PLACES_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "places.displayName", "places.formattedAddress", "places.rating",
        "places.userRatingCount", "places.websiteUri", "places.nationalPhoneNumber",
        "places.internationalPhoneNumber", "places.googleMapsUri",
        "places.primaryTypeDisplayName", "places.id", "nextPageToken",
      ].join(","),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Places HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    places?: Array<{
      id: string; displayName?: { text?: string }; formattedAddress?: string;
      rating?: number; userRatingCount?: number; websiteUri?: string;
      nationalPhoneNumber?: string; internationalPhoneNumber?: string;
      googleMapsUri?: string; primaryTypeDisplayName?: { text?: string };
    }>;
    nextPageToken?: string;
  };
  return {
    results: (data.places ?? []).map((p) => ({
      id: p.id,
      displayName: p.displayName?.text ?? "",
      formattedAddress: p.formattedAddress ?? null,
      rating: p.rating ?? null,
      userRatingCount: p.userRatingCount ?? null,
      websiteUri: p.websiteUri ?? null,
      nationalPhoneNumber: p.nationalPhoneNumber ?? null,
      internationalPhoneNumber: p.internationalPhoneNumber ?? null,
      googleMapsUri: p.googleMapsUri ?? null,
      primaryTypeDisplayName: p.primaryTypeDisplayName?.text ?? null,
    })),
    nextPageToken: data.nextPageToken,
  };
}

export function placesToProspectDraft(p: PlacesResult, niche: string): ProspectDraft {
  // "Rua X, 123 - Centro, São Paulo - SP, 01234-567, Brasil"
  let city: string | null = null;
  let state: string | null = null;
  if (p.formattedAddress) {
    for (const part of p.formattedAddress.split(",").map((s) => s.trim())) {
      const m = part.match(/^([A-Z]{2})$/);
      if (m) state = m[1];
    }
    const parts = p.formattedAddress.split(",").map((s) => s.trim());
    if (parts.length >= 3) city = parts[parts.length - 4] ?? null;
  }
  return {
    source: "google_places",
    sourceId: `google/${p.id}`,
    companyName: p.displayName,
    niche,
    category: p.primaryTypeDisplayName,
    phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
    website: p.websiteUri,
    address: p.formattedAddress,
    city,
    state,
    googleMapsUrl: p.googleMapsUri,
    googleRating: p.rating ?? null,
    googleReviewsCount: p.userRatingCount ?? null,
  };
}

// ─── Job de prospecção: buscar → deduplicar → persistir ─────────────────────

import { upsertProspect, prospectCounters, type ProspectRecord } from "@/db/prospects";
import { recordEvent } from "@/db";
import { NICHOS, getNicho, type Nicho } from "./nichos";

export interface ProspectDraft {
  source: "osm" | "google_places";
  sourceId: string;
  companyName: string;
  niche?: string | null;
  category?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  instagram?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  googleMapsUrl?: string | null;
  googleRating?: number | null;
  googleReviewsCount?: number | null;
}

export interface ProspectingCriteria {
  nicho: string;
  location: string; // "São Paulo" | "SP" | região (sul, sudeste…) | "brasil"
  limit: number; // quantidade desejada
  usePlaces?: boolean; // default true quando chave configurada
}

export interface ProspectingResult {
  nicho: string;
  location: string;
  found: number;
  newProspects: number;
  duplicates: number;
  placesUsed: boolean;
  errors: string[];
}

export async function runProspectingJob(criteria: ProspectingCriteria): Promise<ProspectingResult> {
  const nicho = getNicho(criteria.nicho) ?? NICHOS.find((n) => n.id === "outros")!;
  const result: ProspectingResult = {
    nicho: nicho.id,
    location: criteria.location,
    found: 0,
    newProspects: 0,
    duplicates: 0,
    placesUsed: false,
    errors: [],
  };

  // ── Fase 1: GEOCODE ────────────────────────────────────────────────────────
  const loc = criteria.location.trim();
  const isUf = /^[A-Z]{2}$/i.test(loc) && UF_CENTERS[loc.toUpperCase()];
  const isRegion = REGION_UFS[loc.toLowerCase()] !== undefined;
  const ufs = isRegion
    ? REGION_UFS[loc.toLowerCase()]
    : isUf
      ? [loc.toUpperCase()]
      : [];
  const bboxes: Array<[number, number, number, number]> = [];

  if (!isUf && !isRegion) {
    // cidade (ou cidade + UF no mesmo texto: "São Paulo, SP")
    const [cityPart, statePart] = loc.split(/,\s*/);
    const geo = await geocodeCity(cityPart, statePart ?? undefined);
    if (!geo) throw new Error(`Localização não encontrada: ${loc}`);
    bboxes.push(geo.bbox);
  } else {
    // limite de 4 UFs por execução para não estourar rate limit do Overpass
    for (const uf of ufs.slice(0, 4)) {
      const st = await geocodeState(uf);
      if (st) bboxes.push(st.bbox);
    }
  }

  // ── Fase 2: BUSCAR (Overpass grátis para volume) ───────────────────────────
  const drafts: ProspectDraft[] = [];
  const seenSourceIds = new Set<string>();
  const target = Math.max(1, Math.min(criteria.limit, 5000));
  const perBboxTarget = Math.ceil((target * 1.3) / Math.max(bboxes.length, 1));

  for (const bbox of bboxes) {
    if (drafts.length >= target * 1.3) break;
    try {
      const places = await searchOsmByTags(nicho.osmTags, bbox, Math.max(perBboxTarget, 200));
      for (const p of places) {
        if (drafts.length >= target * 1.3) break;
        const sourceId = `${p.osmType}/${p.osmId}`;
        if (seenSourceIds.has(sourceId)) continue;
        seenSourceIds.add(sourceId);
        drafts.push(osmToProspectDraft(p));
      }
    } catch (err) {
      result.errors.push(`Overpass tags: ${err instanceof Error ? err.message : String(err)}`);
    }
    // fallback por nome para volume, só se ainda faltar
    if (drafts.length < target && nicho.nameRegex) {
      try {
        const byName = await searchOsmByName(nicho.nameRegex, bbox, Math.max(perBboxTarget, 200));
        for (const p of byName) {
          if (drafts.length >= target * 1.3) break;
          const sourceId = `${p.osmType}/${p.osmId}`;
          if (seenSourceIds.has(sourceId)) continue;
          seenSourceIds.add(sourceId);
          drafts.push(osmToProspectDraft(p));
        }
      } catch (err) {
        result.errors.push(`Overpass nome: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ── Fase 2b: Places nos candidatos (se chave configurada) ─────────────────
  const usePlaces = (criteria.usePlaces ?? true) && placesEnabled();
  if (usePlaces && nicho.placesKeywords.length) {
    result.placesUsed = true;
    const cityQuery = !isUf && !isRegion ? loc.split(/,\s*/)[0] : undefined;
    const pagesBudget = Math.ceil(Math.min(target, 200) / 20); // 1 page = 1 req pago
    try {
      for (const kw of nicho.placesKeywords) {
        if (drafts.length >= target * 1.5 || pagesBudget <= 0) break;
        const { results, nextPageToken } = await placesTextSearch(kw, { city: cityQuery, maxResults: 20 });
        for (const p of results) {
          if (seenSourceIds.has(`google/${p.id}`)) continue;
          seenSourceIds.add(`google/${p.id}`);
          drafts.push(placesToProspectDraft(p, nicho.id));
        }
        if (nextPageToken && pagesBudget > 1) {
          const more = await placesTextSearch(kw, { city: cityQuery });
          for (const p of more.results) {
            if (seenSourceIds.has(`google/${p.id}`)) continue;
            seenSourceIds.add(`google/${p.id}`);
            drafts.push(placesToProspectDraft(p, nicho.id));
          }
        }
      }
    } catch (err) {
      result.errors.push(`Places: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  result.found = drafts.length;

  // ── Fase 3: PERSISTIR (dedupe por source+sourceId) ─────────────────────────
  for (const draft of drafts) {
    const { created } = upsertProspect({
      source: draft.source,
      sourceId: draft.sourceId,
      companyName: draft.companyName,
      niche: draft.niche ?? nicho.id,
      category: draft.category ?? null,
      phone: draft.phone ?? null,
      whatsapp: draft.whatsapp ?? null,
      email: draft.email ?? null,
      instagram: draft.instagram ?? null,
      website: draft.website ?? null,
      address: draft.address ?? null,
      city: draft.city ?? null,
      state: draft.state ?? null,
      googleMapsUrl: draft.googleMapsUrl ?? null,
      googleRating: draft.googleRating ?? null,
      googleReviewsCount: draft.googleReviewsCount ?? null,
    });
    if (created) result.newProspects += 1;
    else result.duplicates += 1;
  }

  recordEvent("info", "prospecting_completed", {
    nicho: nicho.id,
    location: criteria.location,
    found: result.found,
    created: result.newProspects,
    duplicates: result.duplicates,
  });
  return result;
}

// helper para testes/painel
export function prospectTotals(): ReturnType<typeof prospectCounters> {
  return prospectCounters();
}

export type { ProspectRecord, Nicho };
