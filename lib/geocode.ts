// Géocodage côté serveur uniquement (jamais depuis le navigateur), via Nominatim (OpenStreetMap), dans le respect de
// sa politique d'usage : 1 requête par seconde au plus (un seul worker par processus, requêtes en série), User-Agent
// identifiable, réponses mises en cache en base (une requête identique n'est jamais renvoyée).
//
// File persistante (table geo_queue) : un redémarrage reprend où on en était. Le worker démarre avec le serveur
// (instrumentation.ts), se réveille à chaque ajout (kick) et vérifie la file toutes les 30 s (ajouts par le script
// scripts/geocode.mjs).
//
// Ordre d'essai, arrêt au premier résultat situé dans le Quintana Roo :
//   0) coordonnées présentes dans le lien Google Maps de la fiche (aucune requête)
//   1) adresse + colonia + ville              → précision « adresse »
//   2) nom du commerce (query du lien Maps) + ville → « commerce »
//   3) zone, puis colonia + ville              → « zone » (décalage aléatoire stable)
//   4) centre de la ville                      → « ville » (décalage aléatoire stable)
// Une position manuelle, DENUE ou importée n'est jamais écrasée.
import { db, now } from "./db";
import { inQrooBox, jitter, mapsQueryText, parseCoords, QROO_BOX, type Precision } from "./geo";

export const USER_AGENT = "BedoltCRM/1.0 (contacto@bedolt.com)";
const PUBLIC_HOST = "nominatim.openstreetmap.org";
const IDLE_MS = 30_000;
const MAX_ATTEMPTS = 5;

/** Base de l'API (NOMINATIM_URL, défaut : instance publique OSM). */
function baseUrl(): string {
  const raw = (process.env.NOMINATIM_URL ?? "").trim() || `https://${PUBLIC_HOST}`;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch {
    return `https://${PUBLIC_HOST}`;
  }
}
/** Intervalle minimal entre deux requêtes : jamais moins de 1 s sur l'instance publique. */
function intervalMs(): number {
  const v = Number(process.env.GEOCODER_INTERVAL_MS);
  const asked = Number.isFinite(v) && v >= 0 ? v : 1100;
  return new URL(baseUrl()).hostname === PUBLIC_HOST ? Math.max(1100, asked) : asked;
}
export const geocoderEnabled = () => process.env.GEOCODER !== "off";

type Cand = { lat: number; lng: number; rank: number; cat: string; type: string; name: string };
type W = {
  timer?: ReturnType<typeof setTimeout>; running: boolean; started: boolean;
  lastReq: number; pausedUntil: number; lastError: string;
  stats: { requests: number; cacheHits: number; rejected: number };
};
const g = globalThis as unknown as { __geo?: W };
const W: W = g.__geo ?? (g.__geo = { running: false, started: false, lastReq: 0, pausedUntil: 0, lastError: "", stats: { requests: 0, cacheHits: 0, rejected: 0 } });

class Retry extends Error { constructor(msg: string, public pauseMs = 0) { super(msg); } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Candidat situé dans le Quintana Roo (État renvoyé par Nominatim + cadre géographique). */
function inQroo(r: { lat: number; lng: number; address?: Record<string, string> }) {
  const a = r.address ?? {};
  const state = a["ISO3166-2-lvl4"] === "MX-ROO" || norm(a.state ?? "") === "quintana roo";
  return state && inQrooBox(r.lat, r.lng);
}

/** Une requête Nominatim (cache en base, 1 req/s, erreurs temporaires → Retry). */
async function search(q: string): Promise<Cand[]> {
  const key = norm(q);
  const hit = db.prepare("SELECT results FROM geo_cache WHERE q=?").get(key) as { results: string } | undefined;
  if (hit) { W.stats.cacheHits++; return JSON.parse(hit.results) as Cand[]; }
  const wait = Math.max(W.lastReq + intervalMs(), W.pausedUntil) - Date.now();
  if (wait > 0) await sleep(wait);
  W.lastReq = Date.now();
  W.stats.requests++;
  const p = new URLSearchParams({
    q, format: "jsonv2", addressdetails: "1", limit: "5", countrycodes: "mx", "accept-language": "es",
    viewbox: `${QROO_BOX.west},${QROO_BOX.north},${QROO_BOX.east},${QROO_BOX.south}`, bounded: "1",
  });
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/search?${p}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000), redirect: "error",
    });
  } catch {
    throw new Retry("Nominatim injoignable (réseau ou délai dépassé).");
  }
  if (res.status === 429 || res.status === 503) throw new Retry(`Nominatim a répondu ${res.status} (trop de requêtes) : pause.`, 120_000);
  if (res.status === 403) throw new Retry("Nominatim a refusé l'accès (403) : pause d'une heure.", 3_600_000);
  if (!res.ok) throw new Retry(`Nominatim a répondu ${res.status}.`, 30_000);
  let data: unknown;
  try { data = JSON.parse(await res.text()); } catch { throw new Retry("Réponse Nominatim illisible.", 30_000); }
  if (!Array.isArray(data)) throw new Retry("Réponse Nominatim inattendue.", 30_000);
  const all = (data as Record<string, unknown>[]).map((r) => ({
    lat: Number(r.lat), lng: Number(r.lon), rank: Number(r.place_rank) || 0,
    cat: String(r.category ?? r.class ?? ""), type: String(r.type ?? ""), name: String(r.name ?? ""),
    address: (r.address ?? {}) as Record<string, string>,
  })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  const kept: Cand[] = all.filter(inQroo).map(({ address: _a, ...c }) => c);
  const rejected = all.length - kept.length;
  W.stats.rejected += rejected;
  db.prepare("INSERT INTO geo_cache(q, results, rejected, at) VALUES(?,?,?,?) ON CONFLICT(q) DO UPDATE SET results=excluded.results, rejected=excluded.rejected, at=excluded.at")
    .run(key, JSON.stringify(kept), rejected, now());
  return kept;
}

const NOT_A_BUSINESS = new Set(["highway", "place", "boundary", "landuse", "natural", "waterway", "railway", "route", "junction"]);
const join = (...p: (string | undefined)[]) => p.map((x) => (x ?? "").trim()).filter(Boolean).join(", ");

type Biz = { id: number; nom: string; adresse: string; colonia: string; ville: string; zone: string; lien_google: string; lat: number | null; geo_source: string };
export type GeoResult = { lat: number; lng: number; precision: Precision; source: "nominatim" | "import"; query: string } | null;

/** Cherche une position pour une fiche (ordre de repli ci-dessus). Ne modifie rien. */
export async function locate(b: Biz): Promise<GeoResult> {
  const fromLink = parseCoords(b.lien_google);
  if (fromLink && inQrooBox(fromLink.lat, fromLink.lng)) return { ...fromLink, precision: "commerce", source: "import", query: "lien Google Maps" };
  const ville = b.ville.trim();
  const tail = ville ? [ville, "Quintana Roo"] : ["Quintana Roo"];
  const pick = async (q: string, ok: (c: Cand) => boolean) => (await search(q)).find(ok);

  if (b.adresse.trim()) {
    const q = join(b.adresse, b.colonia, ...tail);
    const c = await pick(q, (c) => c.rank >= 26);
    if (c) return { lat: c.lat, lng: c.lng, precision: "adresse", source: "nominatim", query: q };
  }
  const name = mapsQueryText(b.lien_google) || b.nom.trim();
  if (name) {
    const q = join(name, ...tail);
    const c = await pick(q, (c) => c.rank >= 26 && !NOT_A_BUSINESS.has(c.cat));
    if (c) return { lat: c.lat, lng: c.lng, precision: "commerce", source: "nominatim", query: q };
  }
  const zones = [...new Set([b.zone.trim(), b.colonia.trim()].filter(Boolean))];
  for (const z of zones) {
    if (ville && norm(z) === norm(ville)) continue;
    const q = join(z, ...tail);
    // Quartier / colonia (rang 13-25), ou voie / lieu portant ce nom (ex. « Avenida Huayacán ») : position approximative.
    const zn = norm(z);
    const c = await pick(q, (c) => c.rank >= 13 && (!ville || norm(c.name) !== norm(ville))
      && (c.rank <= 25 || (zn.length >= 4 && norm(c.name).includes(zn))));
    if (c) return { lat: c.lat, lng: c.lng, precision: "zone", source: "nominatim", query: q };
  }
  if (ville) {
    const q = join(ville, "Quintana Roo", "México");
    const c = await pick(q, (c) => c.rank >= 10 && c.rank <= 22);
    if (c) return { lat: c.lat, lng: c.lng, precision: "ville", source: "nominatim", query: q };
  }
  return null;
}

/** Enregistre une position automatique, sauf si la fiche a entre-temps reçu une position manuelle / DENUE / importée. */
function save(id: number, r: NonNullable<GeoResult>): boolean {
  const p = jitter(id, r.lat, r.lng, r.precision);
  return db.prepare(`UPDATE businesses SET lat=?, lng=?, geo_precision=?, geo_source=?, geo_date=?
    WHERE id=? AND COALESCE(geo_source,'') IN ('','nominatim')`).run(p.lat, p.lng, r.precision, r.source, now(), id).changes > 0;
}

const finish = (id: number, result: string) => db.prepare("UPDATE geo_queue SET done_at=?, result=? WHERE business_id=?").run(now(), result, id);

async function processOne(id: number) {
  const b = db.prepare("SELECT id, nom, adresse, colonia, ville, zone, lien_google, lat, COALESCE(geo_source,'') geo_source FROM businesses WHERE id=?").get(id) as Biz | undefined;
  if (!b) { db.prepare("DELETE FROM geo_queue WHERE business_id=?").run(id); return; }
  if (!["", "nominatim"].includes(b.geo_source)) { finish(id, "ignore"); return; } // manuel / DENUE / import : on n'y touche pas
  try {
    const r = await locate(b);
    if (!r) { finish(id, "aucun"); return; }
    finish(id, save(id, r) ? r.precision : "ignore");
    W.lastError = "";
  } catch (e) {
    if (!(e instanceof Retry)) { console.error("[bedolt-crm] géocodage", id, e); finish(id, "erreur"); return; }
    W.lastError = e.message;
    if (e.pauseMs) W.pausedUntil = Date.now() + e.pauseMs;
    const q = db.prepare("SELECT attempts FROM geo_queue WHERE business_id=?").get(id) as { attempts: number } | undefined;
    const attempts = (q?.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) { finish(id, "erreur"); return; }
    db.prepare("UPDATE geo_queue SET attempts=?, next_try_at=? WHERE business_id=?").run(attempts, Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** attempts), id);
    console.warn(`[bedolt-crm] géocodage : ${e.message} (fiche ${id}, essai ${attempts}/${MAX_ATTEMPTS})`);
  }
}

function schedule(ms: number) {
  if (W.timer) clearTimeout(W.timer);
  W.timer = setTimeout(() => { void tick(); }, ms);
  W.timer.unref?.();
}

async function tick() {
  if (W.running) return;
  W.running = true;
  try {
    const next = db.prepare("SELECT business_id FROM geo_queue WHERE done_at IS NULL AND next_try_at <= ? ORDER BY next_try_at, added_at, business_id LIMIT 1");
    for (;;) {
      if (W.pausedUntil > Date.now()) break;
      const row = next.get(Date.now()) as { business_id: number } | undefined;
      if (!row) break;
      await processOne(row.business_id);
    }
  } catch (e) {
    console.error("[bedolt-crm] géocodage : erreur du worker", e);
  } finally {
    W.running = false;
  }
  const soon = (db.prepare("SELECT MIN(next_try_at) t FROM geo_queue WHERE done_at IS NULL").get() as { t: number | null }).t;
  const wake = Math.max(soon ?? 0, W.pausedUntil);
  schedule(wake ? Math.min(IDLE_MS, Math.max(500, wake - Date.now())) : IDLE_MS);
}

/** Démarre le worker (instrumentation.ts). Sans effet si GEOCODER=off ou déjà démarré. */
export function startGeocoder() {
  if (!geocoderEnabled() || W.started) return;
  W.started = true;
  schedule(3000);
  console.log(`[bedolt-crm] géocodage : worker démarré (${baseUrl()}, ≥ ${intervalMs()} ms entre deux requêtes)`);
}
/** Réveille le worker après un ajout à la file. */
export function kick() { if (geocoderEnabled() && W.started && !W.running) schedule(50); }

/**
 * Ajoute des fiches à la file (celles qui n'ont pas de position manuelle / DENUE / importée).
 * Si aucun lot n'est en cours, l'historique de progression est remis à zéro (nouveau « 0 / N »).
 * `ids` absent : toutes les fiches sans position.
 */
export function enqueue(ids?: number[]): number {
  const t = now();
  const n = db.transaction(() => {
    const pending = (db.prepare("SELECT COUNT(*) n FROM geo_queue WHERE done_at IS NULL").get() as { n: number }).n;
    if (!pending) db.prepare("DELETE FROM geo_queue WHERE done_at IS NOT NULL").run();
    const upsert = `INSERT INTO geo_queue(business_id, added_at) SELECT id, @t FROM businesses
      WHERE %WHERE% AND COALESCE(geo_source,'') IN ('','nominatim')
      ON CONFLICT(business_id) DO UPDATE SET done_at=NULL, result='', attempts=0, next_try_at=0, added_at=excluded.added_at
      WHERE geo_queue.done_at IS NOT NULL`;
    if (!ids) return db.prepare(upsert.replace("%WHERE%", "lat IS NULL")).run({ t }).changes;
    let c = 0;
    const st = db.prepare(upsert.replace("%WHERE%", "id = @id"));
    for (const id of ids) c += st.run({ t, id }).changes;
    return c;
  })();
  if (n) kick();
  return n;
}

export type GeoStatus = {
  total: number; done: number; pending: number; located: number; failed: number;
  missing: number; running: boolean; enabled: boolean; pausedUntil: number | null; lastError: string;
};
/** Progression du lot en cours (« done / total ») et nombre de fiches sans position. */
export function geoStatus(): GeoStatus {
  const q = db.prepare(`SELECT COUNT(*) total, COUNT(done_at) done,
      SUM(CASE WHEN result IN ('commerce','adresse','zone','ville') THEN 1 ELSE 0 END) located,
      SUM(CASE WHEN result IN ('aucun','erreur') THEN 1 ELSE 0 END) failed FROM geo_queue`).get() as { total: number; done: number; located: number | null; failed: number | null };
  const missing = (db.prepare("SELECT COUNT(*) n FROM businesses WHERE lat IS NULL").get() as { n: number }).n;
  return {
    total: q.total, done: q.done, pending: q.total - q.done, located: q.located ?? 0, failed: q.failed ?? 0, missing,
    running: W.running, enabled: geocoderEnabled() && W.started,
    pausedUntil: W.pausedUntil > Date.now() ? W.pausedUntil : null, lastError: W.lastError,
  };
}
export const geoStats = () => ({ ...W.stats });

/** Position saisie à la main (coordonnées, lien Google Maps, point déplacé) : jamais écrasée par le géocodage. */
export function setManualPosition(id: number, lat: number, lng: number): boolean {
  const ok = db.prepare("UPDATE businesses SET lat=?, lng=?, geo_precision='commerce', geo_source='manuel', geo_date=? WHERE id=?")
    .run(Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, now(), id).changes > 0;
  if (ok) db.prepare("UPDATE geo_queue SET done_at=?, result='ignore' WHERE business_id=? AND done_at IS NULL").run(now(), id);
  return ok;
}
/** Efface la position (retour au géocodage automatique) et remet la fiche dans la file. */
export function resetPosition(id: number) {
  db.prepare("UPDATE businesses SET lat=NULL, lng=NULL, geo_precision='', geo_source='', geo_date=NULL WHERE id=?").run(id);
  enqueue([id]);
}
