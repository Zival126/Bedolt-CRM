// API DENUE d'INEGI (https://www.inegi.org.mx/servicios/api_denue.html), côté serveur uniquement : le token ne quitte
// jamais le serveur (il n'apparaît ni dans les réponses, ni dans les messages d'erreur, ni dans le cache).
//
// Formats vérifiés sur la documentation et par de vraies requêtes (le serveur répond « No autorizado » à un token
// invalide sur une route existante et 404 sinon) :
//   Buscar/{condición}/{lat},{lng}/{metros ≤ 5000}/{token}
//   Ficha/{Id}/{token}
//   Nombre/{nombre}/{entidad, 00 = toutes}/{reg_inicial}/{reg_final}/{token}
//   BuscarEntidad/{condición}/{entidad}/{reg_inicial}/{reg_final}/{token}
//   BuscarAreaActEstr/{entidad}/{municipio}/{localidad}/{ageb}/{manzana}/{sector}/{subsector}/{rama}/{clase}/
//                     {nombre}/{reg_inicial}/{reg_final}/{Id}/{estrato}/{token}     (0 = tous ; 14 segments)
//   Cuantificar/{actividades, 2 à 6 chiffres, séparées par des virgules}/{áreas : 23, 23005, 230050001…}/{estrato}/{token}
// Réponses : tableau JSON. Erreurs : HTTP 200 + texte brut (« No autorizado. Utilice una clave válida. »).
import { db } from "./db";
import { denueToken } from "./settings";
import { classOfTitle } from "./scian";
import { localidad } from "./geo-qroo";

const INEGI = "https://www.inegi.org.mx/app/api/denue/v1/consulta";
// DENUE_API_BASE : simulateur local pour le développement / les captures, ignoré en production.
const BASE = process.env.NODE_ENV !== "production" && /^http:\/\/127\.0\.0\.1:\d+\/consulta$/.test(process.env.DENUE_API_BASE ?? "") ? process.env.DENUE_API_BASE! : INEGI;
export const ENTIDAD = "23";
export const PAGE = 500;              // enregistrements par requête paginée
export const MAX_PAGES = 40;          // garde-fou : 20 000 établissements par code
export const CACHE_MS = 24 * 3600_000;
const GAP_MS = Number(process.env.DENUE_GAP_MS ?? 350);  // pause minimale entre deux requêtes (politesse)
const TIMEOUT_MS = 30_000;
const ATTEMPTS = 3;

export class DenueError extends Error { constructor(msg: string, public retry = false) { super(msg); } }

export type DenueRow = {
  clee: string; id: string; nom: string; raison: string; activite: string; classe: string; estrato: string; strate: number;
  tipo: string; adresse: string; colonia: string; cp: string; ubicacion: string; mun: string; municipio: string; ville: string;
  telephone: string; email: string; site_web: string; lat: number | null; lng: number | null; alta: string;
};
type Raw = Record<string, string | undefined>;

const STRATES: [RegExp, number][] = [[/^0\s*a\s*5/, 1], [/^6\s*a\s*10/, 2], [/^11\s*a\s*30/, 3], [/^31\s*a\s*50/, 4], [/^51\s*a\s*100/, 5], [/^101\s*a\s*250/, 6], [/^251/, 7]];
export const strateOf = (estrato: string) => STRATES.find(([re]) => re.test(estrato.trim().toLowerCase()))?.[1] ?? 0;
export const STRATE_LABELS = ["", "0-5 pers.", "6-10", "11-30", "31-50", "51-100", "101-250", "251+"];

const SMALL = new Set(["de", "del", "la", "las", "los", "el", "y", "en", "a"]);
/** « PLAYA DEL CARMEN » → « Playa del Carmen » ; « SUPERMANZANA 63 » → « Supermanzana 63 ». */
export function titleCase(s: string): string {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  if (!t || t !== t.toUpperCase()) return t;
  return t.toLowerCase().split(" ").map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}
const cleanUrl = (s: string) => {
  const v = (s ?? "").trim().toLowerCase();
  if (!v || !/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$|^https?:\/\//.test(v)) return "";
  return /^https?:\/\//.test(v) ? v : "http://" + v;
};
const cleanEmail = (s: string) => { const v = (s ?? "").trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v) ? v : ""; };
const num = (v?: string) => (v && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Ligne DENUE (PascalCase_Snake : CLEE, Nombre, Clase_actividad…) → format du CRM. */
export function mapRow(r: Raw): DenueRow {
  const s = (k: string) => String(r[k] ?? "").trim();
  const adr = [titleCase(s("Tipo_vialidad")), titleCase(s("Calle")), s("Num_Exterior") && `#${s("Num_Exterior")}`, s("Num_Interior") && `Int. ${s("Num_Interior")}`].filter(Boolean).join(" ");
  // Ubicacion = « LOCALIDAD, Municipio, ENTIDAD »
  const parts = s("Ubicacion").split(",").map((x) => x.trim());
  const clee = s("CLEE") || s("Id");
  const area = s("AreaGeo");
  const mun = /^\d{9}$/.test(area) ? area.slice(2, 5) : /^\d{5}/.test(clee) ? clee.slice(2, 5) : "";
  const loc = /^\d{9}$/.test(area) ? localidad(area.slice(2, 5), area.slice(5, 9)) : undefined;
  const activite = s("Clase_actividad");
  const estrato = s("Estrato");
  const lat = num(r.Latitud), lng = num(r.Longitud);
  return {
    clee, id: s("Id"), nom: titleCase(s("Nombre") || s("Razon_social")), raison: s("Razon_social"), activite,
    classe: /^\d{6}$/.test(s("CLASE_ACTIVIDAD_ID")) ? s("CLASE_ACTIVIDAD_ID") : classOfTitle(activite),
    estrato, strate: strateOf(estrato), tipo: s("Tipo"), adresse: adr, colonia: titleCase(s("Colonia")), cp: s("CP"),
    ubicacion: s("Ubicacion"), mun, municipio: parts.length >= 2 ? parts[parts.length - 2] : "",
    ville: loc?.n ?? titleCase(parts[0] ?? ""), telephone: s("Telefono"), email: cleanEmail(s("Correo_e")), site_web: cleanUrl(s("Sitio_internet")),
    lat: lat !== null && Math.abs(lat) <= 90 && lat !== 0 ? lat : null, lng: lng !== null && Math.abs(lng) <= 180 && lng !== 0 ? lng : null,
    alta: /^\d{4}-\d{2}/.test(s("Fecha_Alta")) ? s("Fecha_Alta").slice(0, 7) : "",
  };
}

// ---------- Transport : file d'attente polie, délai d'expiration, reprise, cache 24 h ----------
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const G = globalThis as unknown as { __denue?: { fetcher: Fetcher; chain: Promise<unknown>; last: number; requests: number } };
const T = G.__denue ?? (G.__denue = { fetcher: (u, i) => fetch(u, i), chain: Promise.resolve(), last: 0, requests: 0 });
/** Tests : remplace l'accès réseau. */
export function setDenueFetch(f: Fetcher | null) { T.fetcher = f ?? ((u, i) => fetch(u, i)); }
export const denueStats = () => ({ requests: T.requests });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Une requête à la fois, au moins GAP_MS entre deux. */
function queued<R>(fn: () => Promise<R>): Promise<R> {
  const run = T.chain.then(async () => {
    const wait = T.last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await fn(); } finally { T.last = Date.now(); }
  });
  T.chain = run.catch(() => undefined);
  return run;
}

function interpret(status: number, text: string): Raw[] {
  if (status === 404) throw new DenueError("Méthode DENUE introuvable (404) : format d'URL refusé par INEGI.");
  if (status === 429 || status >= 500) throw new DenueError(`DENUE indisponible (HTTP ${status}).`, true);
  if (status >= 400) throw new DenueError(`DENUE a répondu ${status}.`);
  const t = text.trim();
  let data: unknown = t;
  try { data = JSON.parse(t); } catch { /* texte brut */ }
  if (Array.isArray(data)) return data as Raw[];
  const msg = typeof data === "string" ? data : t;
  if (/no\s+autorizado/i.test(msg)) throw new DenueError("Token DENUE refusé par INEGI : vérifie-le dans Réglages > DENUE.");
  if (!msg || /no se encontr|sin resultados|no hay (datos|registros|resultados)/i.test(msg)) return [];
  throw new DenueError("Réponse DENUE inattendue : " + msg.slice(0, 160).replace(/[a-f0-9-]{30,}/gi, "…"));
}

/** Appel brut (chemin sans le token). Réponses mises en cache 24 h (clé = chemin). */
export async function call(pathNoToken: string, opts: { cache?: boolean } = {}): Promise<Raw[]> {
  const useCache = opts.cache !== false;
  if (useCache) {
    const c = db.prepare("SELECT body, at FROM denue_cache WHERE k = ?").get(pathNoToken) as { body: string; at: number } | undefined;
    if (c && Date.now() - c.at < CACHE_MS) return JSON.parse(c.body) as Raw[];
  }
  const token = denueToken();
  if (!token) throw new DenueError("Token DENUE manquant (Réglages > DENUE).");
  let lastErr: DenueError | null = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const rows = await queued(async () => {
        T.requests++;
        let res: Response;
        try {
          res = await T.fetcher(`${BASE}/${pathNoToken}/${encodeURIComponent(token)}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch (e) {
          const timeout = (e as Error)?.name === "TimeoutError";
          throw new DenueError(timeout ? "DENUE : délai dépassé." : "API INEGI injoignable (réseau ou DNS).", true);
        }
        return interpret(res.status, await res.text());
      });
      if (useCache) {
        db.prepare("INSERT INTO denue_cache(k, body, at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET body=excluded.body, at=excluded.at").run(pathNoToken, JSON.stringify(rows), Date.now());
        if (Math.random() < 0.05) db.prepare("DELETE FROM denue_cache WHERE at < ?").run(Date.now() - CACHE_MS);
      }
      return rows;
    } catch (e) {
      lastErr = e instanceof DenueError ? e : new DenueError((e as Error).message);
      if (!lastErr.retry || attempt === ATTEMPTS) break;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastErr ?? new DenueError("DENUE : erreur inconnue.");
}

const seg = (v: string | number | undefined) => encodeURIComponent(String(v ?? "").trim() || "0");
const words = (s: string) => encodeURIComponent(s.trim().replace(/\s+/g, " ").slice(0, 100));

/** Un code SCIAN de 2 à 6 chiffres placé au bon niveau (5 chiffres : branche + filtre sur la sous-branche). */
export function scianSegments(code: string) {
  const c = code.replace(/\D/g, "");
  const out = { sector: "0", subsector: "0", rama: "0", clase: "0" };
  if (c.length === 2) out.sector = c;
  else if (c.length === 3) out.subsector = c;
  else if (c.length === 4 || c.length === 5) out.rama = c.slice(0, 4);
  else if (c.length === 6) out.clase = c;
  else if (c.length) throw new DenueError("Code SCIAN invalide (2 à 6 chiffres).");
  return out;
}

export type AreaQuery = { municipio?: string; localidad?: string; code?: string; estrato?: string; nombre?: string };
export const areaPath = (q: AreaQuery, ini: number, fin: number) => {
  const a = scianSegments(q.code ?? "");
  return `BuscarAreaActEstr/${ENTIDAD}/${seg(q.municipio)}/${seg(q.localidad)}/0/0/${a.sector}/${a.subsector}/${a.rama}/${a.clase}/${q.nombre?.trim() ? words(q.nombre) : "0"}/${ini}/${fin}/0/${seg(q.estrato)}`;
};
export const buscarArea = async (q: AreaQuery, ini: number, fin: number) => {
  const rows = (await call(areaPath(q, ini, fin))).map(mapRow);
  const c = (q.code ?? "").replace(/\D/g, "");
  return { raw: rows.length, rows: c.length === 5 ? rows.filter((r) => r.classe.startsWith(c)) : rows };
};
export const buscar = async (lat: number, lng: number, rayon: number, condition = "") =>
  (await call(`Buscar/${words(condition.replace(/\s*,\s*/g, ",")) || "todos"}/${lat.toFixed(6)},${lng.toFixed(6)}/${Math.min(Math.max(Math.round(rayon), 1), 5000)}`)).map(mapRow);
export const nombre = async (q: string, ini: number, fin: number) => (await call(`Nombre/${words(q)}/${ENTIDAD}/${ini}/${fin}`)).map(mapRow);
export const buscarEntidad = async (q: string, ini: number, fin: number) => (await call(`BuscarEntidad/${words(q.replace(/\s*,\s*/g, ","))}/${ENTIDAD}/${ini}/${fin}`)).map(mapRow);
export async function ficha(id: string): Promise<DenueRow | null> {
  if (!/^\d{1,12}$/.test(id)) throw new DenueError("Id DENUE invalide.");
  const rows = await call(`Ficha/${id}`, { cache: false });
  return rows.length ? mapRow(rows[0]) : null;
}

export type Count = { ae: string; ag: string; total: number };
/** Cuantificar : nombre d'établissements par activité × zone (codes 2 à 6 chiffres ; zones 23 / 23MMM / 23MMMLLLL). */
export async function cuantificar(codes: string[], areas: string[], estrato = "0"): Promise<Count[]> {
  const ae = codes.map((c) => c.replace(/\D/g, "")).filter((c) => c.length >= 2 && c.length <= 6);
  const ag = areas.map((a) => a.replace(/\D/g, "")).filter((a) => [2, 5, 9].includes(a.length));
  if (!ae.length) ae.push("0");
  if (!ag.length) ag.push(ENTIDAD);
  const rows = await call(`Cuantificar/${ae.join(",")}/${ag.join(",")}/${seg(estrato)}`);
  return rows.map((r) => ({ ae: String(r.AE ?? ""), ag: String(r.AG ?? ""), total: Number(r.Total) || 0 }));
}

export async function denueTest(): Promise<{ ok: boolean; message: string }> {
  try {
    const n = await call(`Cuantificar/8121/${ENTIDAD}/0`, { cache: false });
    return { ok: true, message: `Connexion DENUE OK (${(Number(n[0]?.Total) || 0).toLocaleString("fr-FR")} salons de beauté recensés au Quintana Roo).` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
