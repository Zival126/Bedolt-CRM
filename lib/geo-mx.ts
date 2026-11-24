// Catalogue géographique national (INEGI, Marco Geoestadístico) : 32 entidades, tous les municipios, localidades
// urbaines / cabeceras / ≥ 2 500 hab. (config/geo-mx/, généré par scripts/build-geo-mx.mjs). Les autres localidades
// (rurales) sont demandées au service officiel à la demande et gardées en base (table geo_localidades, 30 jours).
// Recherche de zone instantanée (accents et majuscules ignorés, synonymes), favoris, zone d'une fiche.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { db } from "./db";
import { fold } from "./scian";
import { getSetting, setSetting } from "./settings";

export type Entidad = { c: string; n: string; a: string; p: number };
export type Municipio = { e: string; m: string; n: string; cab: string; p: number; nl?: number };
export type Localidad = { e: string; m: string; c: string; n: string; p: number; u: number; lat: number | null; lng: number | null };
/** Zone DENUE : entidad (2 chiffres, « 00 » = tout le pays), municipio (3), localidad (4) ; vides = tout le niveau. */
export const ZoneSchema = z.object({
  ent: z.string().regex(/^\d{2}$/), mun: z.string().regex(/^(\d{3})?$/).default(""), loc: z.string().regex(/^(\d{4})?$/).default(""),
  label: z.string().trim().max(160).default(""),
});
export type Zone = z.infer<typeof ZoneSchema>;
export type ZoneHit = Zone & { type: "entidad" | "municipio" | "localidad"; sub: string; pop: number; lat: number | null; lng: number | null };

type Data = {
  ents: Entidad[]; munis: Municipio[]; locs: Localidad[]; meta: { source: string; date: string; totalLocs: number };
  entBy: Map<string, Entidad>; munBy: Map<string, Municipio>; locBy: Map<string, Localidad>;
  index: { f: string; words: string[]; hit: ZoneHit }[];
};
const G = globalThis as unknown as { __geomx?: Data };
const read = (f: string) => JSON.parse(fs.readFileSync(path.resolve("config/geo-mx", f), "utf8"));

export function geo(): Data {
  if (G.__geomx) return G.__geomx;
  const e = read("entidades.json"), m = read("municipios.json"), l = read("localidades.json");
  const ents = e.entidades as Entidad[], munis = m.municipios as Municipio[], locs = l.localidades as Localidad[];
  const entBy = new Map(ents.map((x) => [x.c, x]));
  const munBy = new Map(munis.map((x) => [x.e + x.m, x]));
  const locBy = new Map(locs.map((x) => [x.e + x.m + x.c, x]));
  const index: Data["index"] = [];
  const push = (name: string, hit: ZoneHit) => { const f = fold(name); index.push({ f, words: f.split(" "), hit }); };
  for (const x of ents) {
    const top = locs.filter((y) => y.e === x.c).sort((a, b) => b.p - a.p)[0];
    push(x.n, { ent: x.c, mun: "", loc: "", label: x.n, type: "entidad", sub: "État", pop: x.p, lat: top?.lat ?? null, lng: top?.lng ?? null });
  }
  for (const x of munis) {
    const cab = locBy.get(x.e + x.m + x.cab);
    push(x.n, { ent: x.e, mun: x.m, loc: "", label: `${x.n} — ${entBy.get(x.e)?.n ?? x.e}`, type: "municipio", sub: "municipio", pop: x.p, lat: cab?.lat ?? null, lng: cab?.lng ?? null });
  }
  for (const x of locs) {
    if (x.p < 5000 && !x.u) continue;   // recherche : villes (les petites localidades restent dans le sélecteur à 3 niveaux)
    push(x.n, { ent: x.e, mun: x.m, loc: x.c, label: `${x.n} — ${munBy.get(x.e + x.m)?.n ?? x.m}, ${entBy.get(x.e)?.n ?? x.e}`, type: "localidad", sub: "ville", pop: x.p, lat: x.lat, lng: x.lng });
  }
  return (G.__geomx = { ents, munis, locs, entBy, munBy, locBy, index, meta: { source: e._source, date: e._date, totalLocs: l.total_localidades_pays ?? 0 } });
}

export const entidades = () => geo().ents;
export const entidad = (c: string) => geo().entBy.get(c);
export const municipiosOf = (ent: string) => geo().munis.filter((m) => m.e === ent);
export const municipio = (ent: string, mun: string) => geo().munBy.get(ent + mun);
export const localidadMx = (ent: string, mun: string, loc: string) => geo().locBy.get(ent + mun + loc);
export const urbanLocalidades = (ent: string, mun?: string) => geo().locs.filter((l) => l.e === ent && (!mun || l.m === mun));

/** Libellé lisible d'une zone. */
export function zoneLabel(z: { ent: string; mun?: string; loc?: string }): string {
  if (z.ent === "00") return "Tout le Mexique";
  const e = entidad(z.ent)?.n ?? `entidad ${z.ent}`;
  if (!z.mun) return e;
  const m = municipio(z.ent, z.mun)?.n ?? `municipio ${z.mun}`;
  if (!z.loc) return `${m} (${e})`;
  const l = localidadMx(z.ent, z.mun, z.loc)?.n ?? `localidad ${z.loc}`;
  return `${l} — ${m}, ${e}`;
}

// ---------- Recherche ----------
/** Synonymes → noms officiels (résolus dans le catalogue, jamais par code). */
const SYNONYMS: Record<string, { type: ZoneHit["type"]; name: string; state?: string }[]> = {
  cdmx: [{ type: "entidad", name: "Ciudad de México" }], df: [{ type: "entidad", name: "Ciudad de México" }],
  "ciudad de mexico": [{ type: "entidad", name: "Ciudad de México" }], "distrito federal": [{ type: "entidad", name: "Ciudad de México" }],
  edomex: [{ type: "entidad", name: "México" }], "estado de mexico": [{ type: "entidad", name: "México" }], edomx: [{ type: "entidad", name: "México" }],
  playa: [{ type: "localidad", name: "Playa del Carmen", state: "Quintana Roo" }],
  cancun: [{ type: "localidad", name: "Cancún", state: "Quintana Roo" }, { type: "municipio", name: "Benito Juárez", state: "Quintana Roo" }],
  gdl: [{ type: "municipio", name: "Guadalajara", state: "Jalisco" }], mty: [{ type: "municipio", name: "Monterrey", state: "Nuevo León" }],
  qroo: [{ type: "entidad", name: "Quintana Roo" }], "q roo": [{ type: "entidad", name: "Quintana Roo" }],
};

function findExact(type: ZoneHit["type"], name: string, state?: string): ZoneHit | undefined {
  const f = fold(name), st = state ? fold(state) : "";
  return geo().index.filter((x) => x.hit.type === type && x.f === f && (!st || fold(entidad(x.hit.ent)?.n ?? "") === st))
    .sort((a, b) => b.hit.pop - a.hit.pop)[0]?.hit;
}

/** Suggestions de zone pour une saisie libre (« monterrey », « cdmx », « playa »…). */
export function searchZones(q: string, limit = 12): ZoneHit[] {
  const f = fold(q);
  if (f.length < 2) return [];
  const out = new Map<string, { h: ZoneHit; s: number }>();
  const add = (h: ZoneHit, s: number) => { const k = h.ent + h.mun + h.loc; const cur = out.get(k); if (!cur || cur.s < s) out.set(k, { h, s }); };
  for (const syn of SYNONYMS[f] ?? []) { const h = findExact(syn.type, syn.name, syn.state); if (h) add(h, 1000); }
  const qw = f.split(" ");
  for (const x of geo().index) {
    let s = 0;
    if (x.f === f) s = 100;
    else if (x.f.startsWith(f)) s = 80;
    else if (qw.every((w) => x.words.some((v) => v.startsWith(w)))) s = 60;
    else if (f.length >= 4 && x.f.includes(f)) s = 30;
    else continue;
    s += Math.log10(1 + x.hit.pop) * 3 + (x.hit.type === "entidad" ? 6 : x.hit.type === "municipio" ? 2 : 0);
    add(x.hit, s);
  }
  return [...out.values()].sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.h);
}

// ---------- Localidades à la demande (rurales comprises) ----------
type Fetcher = (url: string) => Promise<Response>;
const F = globalThis as unknown as { __geofetch?: { f: Fetcher } };
const T = F.__geofetch ?? (F.__geofetch = { f: (u) => fetch(u, { headers: { "User-Agent": "BedoltCRM/1.0 (contacto@bedolt.com)" }, signal: AbortSignal.timeout(30_000), cache: "no-store" }) });
export function setGeoFetch(f: Fetcher | null) { T.f = f ?? ((u) => fetch(u, { signal: AbortSignal.timeout(30_000) })); }
const CACHE_MS = 30 * 24 * 3600_000;

/** Toutes les localidades d'un municipio (service officiel INEGI, cache 30 jours) ; repli : catalogue local. */
export async function localidadesAll(ent: string, mun: string): Promise<{ list: Localidad[]; source: "cache" | "inegi" | "catalogue" }> {
  if (!/^\d{2}$/.test(ent) || !/^\d{3}$/.test(mun) || !municipio(ent, mun)) return { list: [], source: "catalogue" };
  const k = ent + mun;
  const c = db.prepare("SELECT body, at FROM geo_localidades WHERE k = ?").get(k) as { body: string; at: number } | undefined;
  if (c && Date.now() - c.at < CACHE_MS) return { list: JSON.parse(c.body), source: "cache" };
  try {
    const r = await T.f(`https://gaia.inegi.org.mx/wscatgeo/v2/localidades/${ent}${mun}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = (await r.json()) as { datos?: Record<string, string>[] };
    const list: Localidad[] = (d.datos ?? []).filter((x) => x.cve_ent === ent && x.cve_mun === mun && /^\d{4}$/.test(x.cve_loc)).map((x) => ({
      e: ent, m: mun, c: x.cve_loc, n: String(x.nomgeo ?? "").slice(0, 120), p: Number(x.pob_total) || 0, u: x.ambito === "URBANO" ? 1 : 0,
      lat: Number(x.latitud) || null, lng: Number(x.longitud) || null,
    })).sort((a, b) => b.p - a.p);
    if (!list.length) throw new Error("vide");
    db.prepare("INSERT INTO geo_localidades(k, body, at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET body=excluded.body, at=excluded.at").run(k, JSON.stringify(list), Date.now());
    return { list, source: "inegi" };
  } catch {
    return { list: c ? JSON.parse(c.body) : urbanLocalidades(ent, mun), source: c ? "cache" : "catalogue" };
  }
}

// ---------- Favoris (Réglages) ----------
/** Favoris par défaut : noms officiels résolus dans le catalogue. */
const DEFAULT_FAVORIS: { type: ZoneHit["type"]; name: string; state?: string; label: string }[] = [
  { type: "entidad", name: "Ciudad de México", label: "CDMX" },
  { type: "municipio", name: "Guadalajara", state: "Jalisco", label: "Guadalajara" },
  { type: "municipio", name: "Monterrey", state: "Nuevo León", label: "Monterrey" },
  { type: "municipio", name: "Puebla", state: "Puebla", label: "Puebla" },
  { type: "municipio", name: "Tijuana", state: "Baja California", label: "Tijuana" },
  { type: "municipio", name: "León", state: "Guanajuato", label: "León" },
  { type: "municipio", name: "Querétaro", state: "Querétaro", label: "Querétaro" },
  { type: "municipio", name: "Mérida", state: "Yucatán", label: "Mérida" },
  { type: "municipio", name: "San Luis Potosí", state: "San Luis Potosí", label: "San Luis Potosí" },
  { type: "municipio", name: "Aguascalientes", state: "Aguascalientes", label: "Aguascalientes" },
  { type: "localidad", name: "Cancún", state: "Quintana Roo", label: "Cancún" },
  { type: "municipio", name: "Puerto Morelos", state: "Quintana Roo", label: "Puerto Morelos" },
  { type: "localidad", name: "Playa del Carmen", state: "Quintana Roo", label: "Playa del Carmen" },
  { type: "localidad", name: "Tulum", state: "Quintana Roo", label: "Tulum" },
];
export function defaultFavoris(): Zone[] {
  return DEFAULT_FAVORIS.flatMap((d) => { const h = findExact(d.type, d.name, d.state); return h ? [{ ent: h.ent, mun: h.mun, loc: h.loc, label: d.label }] : []; });
}
export const FavorisSchema = z.array(ZoneSchema).max(40);
export function favoris(): Zone[] {
  try { const r = FavorisSchema.safeParse(JSON.parse(getSetting("geo_favoris") || "null")); if (r.success) return r.data; } catch { /* défaut */ }
  return defaultFavoris();
}
export const saveFavoris = (z: Zone[]) => setSetting("geo_favoris", JSON.stringify(z.map((x) => ({ ...x, label: x.label || zoneLabel(x) }))));

// ---------- Zone d'une fiche ----------
const R = 6371;
const km = (a: number, b: number, c: number, d: number) => { const t = Math.PI / 180; const x = (d - b) * t * Math.cos(((a + c) / 2) * t), y = (c - a) * t; return Math.sqrt(x * x + y * y) * R; };
export const inMexicoBox = (lat: number, lng: number) => lat >= 14.3 && lat <= 32.8 && lng >= -118.5 && lng <= -86.6;

/**
 * État et municipio d'une fiche : localidad la plus proche (≤ 25 km) si la position est connue ; sinon nom de la ville
 * (d'abord dans l'État indiqué, puis nom unique dans tout le pays).
 */
export function inferZone(b: { lat?: number | null; lng?: number | null; ville?: string; etat_code?: string }): { ent: string; mun: string } | null {
  const g = geo();
  if (b.lat != null && b.lng != null && inMexicoBox(b.lat, b.lng)) {
    let best: Localidad | null = null, bd = 25;
    for (const l of g.locs) {
      if (l.lat == null || l.lng == null || Math.abs(l.lat - b.lat) > 0.3 || Math.abs(l.lng - b.lng) > 0.3) continue;
      const d = km(b.lat, b.lng, l.lat, l.lng);
      if (d < bd) { bd = d; best = l; }
    }
    if (best) return { ent: best.e, mun: best.m };
  }
  const v = fold(b.ville ?? "");
  if (!v) return null;
  const inState = (e: string) => !b.etat_code || e === b.etat_code;
  const locs = g.locs.filter((l) => fold(l.n) === v && inState(l.e)).sort((a, x) => x.p - a.p);
  if (locs.length && (b.etat_code || new Set(locs.map((l) => l.e + l.m)).size === 1 || locs[0].p > 10 * (locs[1]?.p ?? 0))) return { ent: locs[0].e, mun: locs[0].m };
  const munis = g.munis.filter((m) => fold(m.n) === v && inState(m.e));
  if (munis.length === 1) return { ent: munis[0].e, mun: munis[0].m };
  return null;
}

/** État attendu pour un résultat Nominatim : noms comparés sans accents (« Coahuila » ≈ « Coahuila de Zaragoza »). */
export function sameState(catalogName: string, nominatimState: string): boolean {
  const a = fold(catalogName), b = fold(nominatimState).replace(/^estado de /, "");
  if (!a || !b) return false;
  return a === b || a.startsWith(b + " ") || b.startsWith(a + " ");
}
