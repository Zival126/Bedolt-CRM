// OpenStreetMap via l'API Overpass (gratuite, sans clé), côté serveur uniquement.
// Usage respectueux : User-Agent identifiable, une requête à la fois, délai d'expiration, cache 24 h, reprise sur
// 429 / 504 (Retry-After), zone limitée. Données © OpenStreetMap contributors (ODbL).
import { createHash } from "node:crypto";
import { db } from "./db";
import { titleCase } from "./denue";
import { nicheResolver } from "./category-map";
import type { Candidate } from "./sources";

export const OVERPASS_URL = () => {
  const u = (process.env.OVERPASS_URL ?? "").trim();
  return /^https:\/\/[a-z0-9.-]+(\/[\w/.-]*)?$/i.test(u) ? u : "https://overpass-api.de/api/interpreter";
};
const UA = "BedoltCRM/1.0 (contacto@bedolt.com)";
const CACHE_MS = 24 * 3600_000;
export const MAX_SPAN = 0.6;          // degrés (≈ 65 km) : au-delà, la zone est refusée (préférer un municipio)
export const MAX_RESULTS = 3000;

export class OsmError extends Error {}
export type Bbox = { s: number; w: number; n: number; e: number };
export type OsmElement = { type: "node" | "way" | "relation"; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const G = globalThis as unknown as { __osm?: { fetcher: Fetcher; chain: Promise<unknown>; sleep: (ms: number) => Promise<void> } };
const T = G.__osm ?? (G.__osm = { fetcher: (u, i) => fetch(u, i), chain: Promise.resolve(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
/** Tests : réseau et attentes simulés. */
export function setOsmFetch(f: Fetcher | null, sleep?: (ms: number) => Promise<void>) {
  T.fetcher = f ?? ((u, i) => fetch(u, i));
  T.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
}

const TAG_RE = /^(shop|amenity|leisure|healthcare|craft|office|tourism)=[a-z0-9_;:-]+$/;
export const validTag = (t: string) => TAG_RE.test(t);

export function checkBbox(b: Bbox): Bbox {
  const r = (x: number) => Math.round(x * 1e5) / 1e5;
  const box = { s: r(Math.min(b.s, b.n)), n: r(Math.max(b.s, b.n)), w: r(Math.min(b.w, b.e)), e: r(Math.max(b.w, b.e)) };
  if (![box.s, box.n, box.w, box.e].every(Number.isFinite) || box.s < -90 || box.n > 90 || box.w < -180 || box.e > 180) throw new OsmError("Zone invalide.");
  if (box.n - box.s > MAX_SPAN || box.e - box.w > MAX_SPAN) throw new OsmError("Zone trop grande : zoome sur la carte ou choisis un municipio.");
  return box;
}

/** Requête Overpass QL : établissements des catégories demandées dans la zone (nœuds, chemins, relations → centre). */
export function buildQuery(tags: string[], b: Bbox): string {
  const bb = `${b.s},${b.w},${b.n},${b.e}`;
  const parts = tags.filter(validTag).map((t) => { const [k, v] = t.split("="); return `nwr["${k}"="${v}"](${bb});`; });
  if (!parts.length) throw new OsmError("Choisis au moins une catégorie OSM.");
  return `[out:json][timeout:60];(${parts.join("")});out center tags ${MAX_RESULTS};`;
}

/** Une requête Overpass à la fois ; 429 / 504 → attente (Retry-After) et nouvel essai (3 au total). */
export async function overpass(query: string): Promise<{ elements: OsmElement[]; cached: boolean; osm3s?: { timestamp_osm_base?: string } }> {
  const k = "osm:" + createHash("sha1").update(query).digest("hex");
  const c = db.prepare("SELECT body, at FROM http_cache WHERE k = ?").get(k) as { body: string; at: number } | undefined;
  if (c && Date.now() - c.at < CACHE_MS) return { ...JSON.parse(c.body), cached: true };
  const run = T.chain.then(async () => {
    let last = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      let res: Response;
      try {
        res = await T.fetcher(OVERPASS_URL(), {
          method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: "data=" + encodeURIComponent(query), signal: AbortSignal.timeout(90_000), cache: "no-store",
        });
      } catch (e) {
        last = (e as Error).name === "TimeoutError" ? "Overpass : délai dépassé." : "Overpass injoignable (réseau).";
        await T.sleep(5000 * attempt); continue;
      }
      if (res.status === 429 || res.status === 504 || res.status === 503) {
        const ra = Number(res.headers.get("retry-after"));
        last = res.status === 429 ? "Overpass : trop de requêtes (429)." : `Overpass surchargé (${res.status}).`;
        await res.text().catch(() => "");
        await T.sleep(Math.min(120_000, (Number.isFinite(ra) && ra > 0 ? ra : 10 * attempt) * 1000));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new OsmError(`Overpass a répondu ${res.status} : ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160)}`);
      let data: { elements?: OsmElement[]; remark?: string; osm3s?: { timestamp_osm_base?: string } };
      try { data = JSON.parse(text); } catch { throw new OsmError("Réponse Overpass illisible."); }
      if (!Array.isArray(data.elements)) throw new OsmError("Réponse Overpass inattendue.");
      if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) throw new OsmError("Overpass : " + data.remark.slice(0, 160));
      const out = { elements: data.elements, osm3s: data.osm3s };
      db.prepare("INSERT INTO http_cache(k, body, at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET body=excluded.body, at=excluded.at").run(k, JSON.stringify(out), Date.now());
      return { ...out, cached: false };
    }
    throw new OsmError(last + " Réessaie dans quelques minutes.");
  });
  T.chain = run.catch(() => undefined);
  return run;
}

const first = (t: Record<string, string>, keys: string[]) => { for (const k of keys) if (t[k]?.trim()) return t[k].split(";")[0].trim(); return ""; };
const url = (v: string) => { const x = v.trim(); if (!x) return ""; return /^https?:\/\//i.test(x) ? x : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(x) ? "https://" + x : ""; };
const social = (v: string, host: string) => {
  const x = v.trim();
  if (!x) return "";
  if (/^https?:\/\//i.test(x)) return x;
  const h = x.replace(/^@/, "").replace(new RegExp(`^(www\\.)?${host}/`, "i"), "");
  return /^[\w.]{1,80}$/.test(h) ? `https://www.${host}/${h}` : "";
};

/** Élément OSM → candidat commun (catégorie = 1er tag reconnu, niche via la table de correspondance). */
export function toCandidates(elements: OsmElement[]): Candidate[] {
  const niche = nicheResolver("osm");
  const out: Candidate[] = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const nom = (t.name || t.brand || t["name:es"] || "").trim();
    const lat = el.lat ?? el.center?.lat ?? null, lng = el.lon ?? el.center?.lon ?? null;
    if (!nom || lat == null || lng == null) continue;
    const cats = ["shop", "amenity", "leisure", "healthcare", "craft", "office", "tourism"].filter((k) => t[k]).map((k) => `${k}=${t[k]}`);
    out.push({
      source: "osm", sourceId: `${el.type}/${el.id}`, nom: nom.slice(0, 300), categorie: cats[0] ?? "", niche: niche(cats),
      telephone: first(t, ["phone", "contact:phone", "contact:mobile", "mobile"]), whatsapp: first(t, ["contact:whatsapp", "whatsapp"]),
      email: first(t, ["email", "contact:email"]).toLowerCase(), site_web: url(first(t, ["website", "contact:website", "url"])),
      facebook: social(first(t, ["contact:facebook", "facebook"]), "facebook.com"), instagram: social(first(t, ["contact:instagram", "instagram"]), "instagram.com"),
      tiktok: social(first(t, ["contact:tiktok"]), "tiktok.com"),
      adresse: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ").slice(0, 300),
      colonia: titleCase(first(t, ["addr:suburb", "addr:neighbourhood", "addr:quarter"])), ville: first(t, ["addr:city", "addr:town", "addr:village"]),
      lat, lng, horaires: (t.opening_hours ?? "").slice(0, 300),
    });
  }
  return out;
}

export async function searchOsm(tags: string[], bbox: Bbox) {
  const box = checkBbox(bbox);
  const r = await overpass(buildQuery(tags, box));
  return { candidates: toCandidates(r.elements), total: r.elements.length, cached: r.cached, base: r.osm3s?.timestamp_osm_base ?? "", truncated: r.elements.length >= MAX_RESULTS };
}
