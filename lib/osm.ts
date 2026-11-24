// OpenStreetMap via l'API Overpass (gratuite, sans clé), côté serveur uniquement.
// Usage respectueux : User-Agent identifiable, une requête à la fois, délai d'expiration, cache 24 h.
// Les instances publiques sont souvent saturées (502 / 504 « server at capacity ») : liste d'instances avec bascule
// automatique (ordre réglable dans Réglages > Sources & clés, OVERPASS_URL en tête si défini), reprise exponentielle
// sur 429 / 502 / 503 / 504 (Retry-After respecté), requêtes légères (tags limités, [timeout:25], « out center tags »),
// grande zone découpée en tuiles. Données © OpenStreetMap contributors (ODbL).
import { createHash } from "node:crypto";
import { db } from "./db";
import { titleCase } from "./denue";
import { nicheResolver } from "./category-map";
import { getSetting, setSetting } from "./settings";
import type { Candidate } from "./sources";

/** Instances publiques à couverture mondiale (liste officielle du wiki OSM « Overpass API »). */
export const DEFAULT_INSTANCES = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const URL_RE = /^https:\/\/[a-z0-9.-]+(\/[\w/.-]*)?$/i;
export const validInstance = (u: string) => URL_RE.test(u.trim());
/** Instances enregistrées dans Réglages (ou défaut), OVERPASS_URL du .env en premier. */
export function osmInstances(): string[] {
  let list: string[] = DEFAULT_INSTANCES;
  try { const v = JSON.parse(getSetting("osm_instances") || "null"); if (Array.isArray(v) && v.length) list = v.filter((x) => typeof x === "string" && validInstance(x)); } catch { /* défaut */ }
  const env = (process.env.OVERPASS_URL ?? "").trim();
  return [...new Set([...(validInstance(env) ? [env] : []), ...(list.length ? list : DEFAULT_INSTANCES)])];
}
export const saveOsmInstances = (l: string[]) => setSetting("osm_instances", JSON.stringify([...new Set(l.map((x) => x.trim()).filter(validInstance))].slice(0, 8)));
export const OVERPASS_URL = () => osmInstances()[0];
export const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };

const UA = "BedoltCRM/1.0 (contacto@bedolt.com)";
const CACHE_MS = 24 * 3600_000;
export const MAX_SPAN = 1.2;          // degrés (≈ 130 km) : au-delà, la zone est refusée
export const TILE = 0.3;              // côté d'une tuile (≈ 33 km) : une grande zone = plusieurs petites requêtes
export const MAX_TAGS = 16;
export const MAX_RESULTS = 3000;
const MAX_ATTEMPTS = 6;

export class OsmError extends Error { constructor(msg: string, public retryable = false) { super(msg); } }
export type Bbox = { s: number; w: number; n: number; e: number };
export type OsmElement = { type: "node" | "way" | "relation"; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
/** Suivi d'une recherche : tuile en cours, attente avant un nouvel essai. */
export type OsmEvent = { type: "tile"; tile: number; tiles: number } | { type: "wait"; seconds: number; server: string; next: string; reason: string };

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
  if (box.n - box.s > MAX_SPAN || box.e - box.w > MAX_SPAN) throw new OsmError("Zone trop grande : zoome sur la carte ou choisis une ville.");
  return box;
}

/** Découpe une zone en tuiles de TILE degrés au plus. */
export function tilesOf(b: Bbox): Bbox[] {
  const ny = Math.max(1, Math.ceil((b.n - b.s) / TILE - 1e-9)), nx = Math.max(1, Math.ceil((b.e - b.w) / TILE - 1e-9));
  const r = (x: number) => Math.round(x * 1e5) / 1e5;
  const out: Bbox[] = [];
  for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++)
    out.push({ s: r(b.s + ((b.n - b.s) * i) / ny), n: r(b.s + ((b.n - b.s) * (i + 1)) / ny), w: r(b.w + ((b.e - b.w) * j) / nx), e: r(b.w + ((b.e - b.w) * (j + 1)) / nx) });
  return out;
}

/** Requête Overpass QL légère : établissements des catégories demandées (nœuds, chemins, relations → centre). */
export function buildQuery(tags: string[], b: Bbox): string {
  const bb = `${b.s},${b.w},${b.n},${b.e}`;
  const parts = [...new Set(tags.filter(validTag))].slice(0, MAX_TAGS).map((t) => { const [k, v] = t.split("="); return `nwr["${k}"="${v}"](${bb});`; });
  if (!parts.length) throw new OsmError("Choisis au moins une catégorie OSM.");
  return `[out:json][timeout:25];(${parts.join("")});out center tags ${MAX_RESULTS};`;
}

const BUSY = new Set([429, 502, 503, 504]);
const reasonOf = (st: number) => (st === 429 ? "trop de requêtes" : st === 504 ? "délai dépassé côté serveur" : "serveur saturé");

/**
 * Une requête Overpass à la fois. Serveur saturé (429 / 502 / 503 / 504), réseau en panne ou délai dépassé → attente
 * (Retry-After, sinon 5 s, 10 s, 20 s… 60 s au plus) puis essai sur le serveur suivant de la liste. `prefer` : index du
 * serveur à essayer d'abord (« Réessayer avec un autre serveur »).
 */
export async function overpass(query: string, opts: { prefer?: number; onEvent?: (e: OsmEvent) => void } = {}): Promise<{ elements: OsmElement[]; cached: boolean; server?: string; osm3s?: { timestamp_osm_base?: string } }> {
  const k = "osm:" + createHash("sha1").update(query).digest("hex");
  const c = db.prepare("SELECT body, at FROM http_cache WHERE k = ?").get(k) as { body: string; at: number } | undefined;
  if (c && Date.now() - c.at < CACHE_MS) return { ...JSON.parse(c.body), cached: true };
  const servers = osmInstances();
  const run = T.chain.then(async () => {
    let i = Math.abs(opts.prefer ?? 0) % servers.length, last = "", busy = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const url = servers[i];
      let res: Response | null = null, wait = 0;
      try {
        res = await T.fetcher(url, {
          method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: "data=" + encodeURIComponent(query), signal: AbortSignal.timeout(45_000), cache: "no-store",
        });
      } catch (e) {
        last = (e as Error).name === "TimeoutError" ? "délai dépassé" : "serveur injoignable";
      }
      if (res && BUSY.has(res.status)) {
        const ra = Number(res.headers.get("retry-after"));
        last = reasonOf(res.status); busy++;
        await res.text().catch(() => "");
        if (Number.isFinite(ra) && ra > 0) wait = Math.min(120, ra) * 1000;
        res = null;
      } else if (res) {
        const text = await res.text();
        if (!res.ok) throw new OsmError(res.status === 400 ? "OpenStreetMap n'a pas compris la recherche (catégories invalides)." : `Le serveur OpenStreetMap ${hostOf(url)} a refusé la recherche (erreur ${res.status}). Réessaie avec un autre serveur.`, true);
        let data: { elements?: OsmElement[]; remark?: string; osm3s?: { timestamp_osm_base?: string } };
        try { data = JSON.parse(text); } catch { last = "réponse illisible"; data = {}; }
        if (Array.isArray(data.elements)) {
          if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) {
            last = "zone trop chargée"; busy++;
          } else {
            const out = { elements: data.elements, osm3s: data.osm3s };
            db.prepare("INSERT INTO http_cache(k, body, at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET body=excluded.body, at=excluded.at").run(k, JSON.stringify(out), Date.now());
            return { ...out, cached: false, server: hostOf(url) };
          }
        } else if (!last) last = "réponse inattendue";
      }
      if (attempt === MAX_ATTEMPTS) break;
      const next = servers[(i + 1) % servers.length];
      wait ||= Math.min(60_000, 5000 * 2 ** (attempt - 1));
      opts.onEvent?.({ type: "wait", seconds: Math.round(wait / 1000), server: hostOf(url), next: hostOf(next), reason: last });
      await T.sleep(wait);
      i = (i + 1) % servers.length;
    }
    throw new OsmError(busy
      ? `Les serveurs OpenStreetMap sont saturés en ce moment (${last}, ${servers.length} serveur(s) essayé(s)). Réessaie dans quelques minutes, ou avec un autre serveur.`
      : `Les serveurs OpenStreetMap ne répondent pas (${last}). Vérifie la connexion du serveur, puis réessaie.`, true);
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

export async function searchOsm(tags: string[], bbox: Bbox, opts: { prefer?: number; onEvent?: (e: OsmEvent) => void } = {}) {
  const box = checkBbox(bbox);
  const tiles = tilesOf(box);
  const seen = new Map<string, OsmElement>();
  let cached = true, base = "", truncated = false, server = "";
  for (const [i, t] of tiles.entries()) {
    if (tiles.length > 1) opts.onEvent?.({ type: "tile", tile: i + 1, tiles: tiles.length });
    const r = await overpass(buildQuery(tags, t), opts);
    cached &&= r.cached; base ||= r.osm3s?.timestamp_osm_base ?? ""; server ||= r.server ?? "";
    if (r.elements.length >= MAX_RESULTS) truncated = true;
    for (const el of r.elements) seen.set(`${el.type}/${el.id}`, el);
  }
  const elements = [...seen.values()];
  return { candidates: toCandidates(elements), total: elements.length, cached, base, truncated, tiles: tiles.length, server };
}
