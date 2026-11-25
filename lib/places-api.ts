// Sources API de lieux (toutes optionnelles, désactivées sans clé) : Foursquare Places, HERE Geocoding & Search,
// TomTom Search, Google Places (Text Search). Côté serveur uniquement : la clé (.env) n'est jamais envoyée au navigateur.
// - Plafond mensuel réglable par source (Réglages > Sources & clés) : vérifié AVANT chaque appel, l'appel est refusé
//   si le plafond serait dépassé ; compteur du mois (fuseau de Cancún) dans api_usage.
// - Conditions d'utilisation : par défaut, seuls l'identifiant de la source et le nom confirmé en ajoutant sont stockés
//   (mode « identifiant ») ; téléphone, site, adresse, catégorie s'affichent en direct et ne vont dans la fiche que si
//   l'utilisateur clique « Copier dans la fiche ». Mode « complet » seulement si le contrat le permet.
// - Cache des réponses (http_cache) seulement quand les conditions le permettent (voir PROVIDERS[...].cache).
import { createHash } from "node:crypto";
import { db, today } from "./db";
import { getSetting, setSetting } from "./settings";
import { telNorm } from "./phone";
import type { Candidate } from "./sources";

export type ApiKey = "foursquare" | "here" | "tomtom" | "google";
export const API_KEYS: ApiKey[] = ["foursquare", "here", "tomtom", "google"];
export type Storage = "id" | "full";

/** Lieu renvoyé par une API (affiché ; stocké selon le mode de stockage). */
export type ApiPlace = {
  id: string; nom: string; categorie: string; telephone: string; site_web: string; email: string; facebook: string; instagram: string;
  adresse: string; colonia: string; ville: string; lat: number | null; lng: number | null; maps: string;
};
export type SearchQuery = { lat: number; lng: number; radius: number; term: string; limit: number };

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const G = globalThis as unknown as { __papi?: { f: Fetcher } };
const T = G.__papi ?? (G.__papi = { f: (u, i) => fetch(u, i) });
/** Tests : réseau simulé. */
export function setPlacesFetch(f: Fetcher | null) { T.f = f ?? ((u, i) => fetch(u, i)); }

export class ApiError extends Error { constructor(msg: string, public code: "nokey" | "cap" | "http" | "network" = "http") { super(msg); } }

type Provider = {
  key: ApiKey; label: string; env: string; defaultCap: number; idCol: "foursquare_id" | "here_id" | "tomtom_id" | "google_place_id";
  /** Durée de cache autorisée (ms) ; 0 = aucun cache serveur (conditions d'utilisation). */
  cache: (res: Response | null) => number;
  attribution: string; free: string; storageNote: string; keyHelp: string; termHelp: string;
  search: (q: SearchQuery, key: string) => { url: string; init: RequestInit; parse: (j: unknown) => ApiPlace[] };
  details: (id: string, key: string) => { url: string; init: RequestInit; parse: (j: unknown) => ApiPlace | null };
};

const s = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const web = (v: string) => (/^https?:\/\//i.test(v) ? v : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) ? "https://" + v : "");
const blank = (p: Partial<ApiPlace>): ApiPlace => ({ id: "", nom: "", categorie: "", telephone: "", site_web: "", email: "", facebook: "", instagram: "", adresse: "", colonia: "", ville: "", lat: null, lng: null, maps: "", ...p });
const hex24 = /^[0-9a-f]{24}$/i;
const hereCat = /^\d{3}-\d{4}-\d{4}$/;

// ---------- Foursquare Places API (places-api.foursquare.com, clé de service « Bearer ») ----------
const fsqPlace = (x: unknown): ApiPlace => {
  const r = obj(x), loc = obj(r.location), soc = obj(r.social_media);
  return blank({
    id: s(r.fsq_place_id ?? r.fsq_id), nom: s(r.name), categorie: s(obj(arr(r.categories)[0]).name),
    telephone: s(r.tel), site_web: web(s(r.website)), email: s(r.email).toLowerCase(),
    facebook: s(soc.facebook_id) ? `https://www.facebook.com/${s(soc.facebook_id)}` : "", instagram: s(soc.instagram) ? `https://www.instagram.com/${s(soc.instagram).replace(/^@/, "")}` : "",
    adresse: s(loc.address) || s(loc.formatted_address), ville: s(loc.locality), colonia: s(loc.neighborhood ?? ""),
    lat: num(r.latitude) ?? num(obj(obj(r.geocodes).main).latitude), lng: num(r.longitude) ?? num(obj(obj(r.geocodes).main).longitude),
  });
};
const fsqHeaders = (key: string) => ({ Authorization: `Bearer ${key}`, "X-Places-Api-Version": "2025-06-17", Accept: "application/json" });

// ---------- HERE Geocoding & Search v7 (Discover : texte ; Browse : codes de catégorie) ----------
const herePlace = (x: unknown): ApiPlace => {
  const r = obj(x), a = obj(r.address), pos = obj(r.position), c = obj(arr(r.contacts)[0]);
  const first = (k: string) => s(obj(arr(c[k])[0]).value);
  return blank({
    id: s(r.id), nom: s(r.title), categorie: s(obj(arr(r.categories).find((y) => obj(y).primary) ?? arr(r.categories)[0]).name),
    telephone: first("phone") || first("mobile"), site_web: web(first("www")), email: first("email").toLowerCase(),
    adresse: [s(a.street), s(a.houseNumber)].filter(Boolean).join(" ") || s(a.label), colonia: s(a.district), ville: s(a.city),
    lat: num(pos.lat), lng: num(pos.lng),
  });
};

// ---------- TomTom Search API (Category Search ; identifiant numérique = categorySet) ----------
const tomtomPlace = (x: unknown): ApiPlace => {
  const r = obj(x), poi = obj(r.poi), a = obj(r.address), pos = obj(r.position);
  return blank({
    id: s(r.id), nom: s(poi.name), categorie: s(arr(poi.categories)[0]), telephone: s(poi.phone), site_web: web(s(poi.url)),
    adresse: [s(a.streetName), s(a.streetNumber)].filter(Boolean).join(" ") || s(a.freeformAddress), colonia: s(a.municipalitySubdivision), ville: s(a.municipality),
    lat: num(pos.lat), lng: num(pos.lon),
  });
};

// ---------- Google Places API (New) : Text Search ; champs Enterprise (téléphone, site) en option ----------
const googleRich = () => getSetting("api_google_rich") === "1";
const GOOGLE_FIELDS = () => ["id", "displayName", "formattedAddress", "location", "primaryTypeDisplayName", "googleMapsUri", ...(googleRich() ? ["nationalPhoneNumber", "websiteUri"] : [])];
const googlePlace = (x: unknown): ApiPlace => {
  const r = obj(x), loc = obj(r.location);
  return blank({
    id: s(r.id), nom: s(obj(r.displayName).text), categorie: s(obj(r.primaryTypeDisplayName).text), telephone: s(r.nationalPhoneNumber),
    site_web: web(s(r.websiteUri)), adresse: s(r.formattedAddress), lat: num(loc.latitude), lng: num(loc.longitude), maps: s(r.googleMapsUri),
  });
};

const headerMaxAge = (res: Response | null) => {
  const cc = res?.headers.get("cache-control") ?? "";
  if (/no-store|no-cache|private/i.test(cc)) return 0;
  const m = cc.match(/max-age=(\d+)/i);
  return m ? Math.min(24 * 3600_000, Number(m[1]) * 1000) : 0;
};

export const PROVIDERS: Record<ApiKey, Provider> = {
  foursquare: {
    key: "foursquare", label: "Foursquare", env: "FOURSQUARE_API_KEY", defaultCap: 9000, idCol: "foursquare_id",
    cache: () => 0,
    attribution: "Powered by Foursquare",
    free: "Bac à sable puis paiement à l'usage ; 10 000 appels « Pro » gratuits par mois (recherche avec les champs par défaut). Les champs « Premium » (téléphone, site, réseaux selon la version) sont payants.",
    storageNote: "Conditions (Usage Guidelines) : seul l'identifiant fsq_place_id peut être gardé sans limite ; les autres attributs ne doivent pas être mis en cache par un compte « pay-as-you-go » / bac à sable. Afficher « Powered by Foursquare ».",
    keyHelp: "foursquare.com/developers → Projet → « Service API Key » → FOURSQUARE_API_KEY=… dans .env",
    termHelp: "mot-clé (ex. dentista) ou identifiant de catégorie Foursquare (24 caractères)",
    search: (q, key) => {
      const p = new URLSearchParams({ ll: `${q.lat},${q.lng}`, radius: String(Math.min(100_000, q.radius)), limit: String(Math.min(50, q.limit)) });
      if (hex24.test(q.term)) p.set("fsq_category_ids", q.term); else p.set("query", q.term);
      return { url: "https://places-api.foursquare.com/places/search?" + p, init: { headers: fsqHeaders(key) }, parse: (j) => arr(obj(j).results).map(fsqPlace) };
    },
    details: (id, key) => ({ url: `https://places-api.foursquare.com/places/${encodeURIComponent(id)}`, init: { headers: fsqHeaders(key) }, parse: (j) => (obj(j).name ? fsqPlace(j) : null) }),
  },
  here: {
    key: "here", label: "HERE", env: "HERE_API_KEY", defaultCap: 4500, idCol: "here_id",
    cache: () => 24 * 3600_000,
    attribution: "© HERE",
    free: "Base Plan : quota gratuit mensuel de Geocoding & Search (Browse est facturé comme Discover). Le chiffre exact dépend de ton plan : vérifie-le dans le portail HERE et règle le plafond en dessous.",
    storageNote: "Conditions HERE Platform : pas de stockage des résultats plus de 30 jours (cache de 24 h ici) ; le CRM ne garde que l'identifiant et ce que tu ajoutes. Attribution « © HERE » sur les données affichées.",
    keyHelp: "platform.here.com → Access Manager → Apps → « API Key » → HERE_API_KEY=… dans .env",
    termHelp: "mot-clé (ex. dentista) ou code de catégorie HERE (ex. 800-8000-0000)",
    search: (q, key) => {
      const circle = `circle:${q.lat},${q.lng};r=${Math.min(250_000, q.radius)}`;
      const p = new URLSearchParams({ in: circle, limit: String(Math.min(100, q.limit)), lang: "es-MX", apiKey: key });
      if (hereCat.test(q.term)) { p.set("at", `${q.lat},${q.lng}`); p.set("categories", q.term); return { url: "https://browse.search.hereapi.com/v1/browse?" + p, init: {}, parse: (j) => arr(obj(j).items).map(herePlace) }; }
      p.set("q", q.term);
      return { url: "https://discover.search.hereapi.com/v1/discover?" + p, init: {}, parse: (j) => arr(obj(j).items).map(herePlace) };
    },
    details: (id, key) => ({ url: "https://lookup.search.hereapi.com/v1/lookup?" + new URLSearchParams({ id, lang: "es-MX", apiKey: key }), init: {}, parse: (j) => (obj(j).title ? herePlace(j) : null) }),
  },
  tomtom: {
    key: "tomtom", label: "TomTom", env: "TOMTOM_API_KEY", defaultCap: 2000, idCol: "tomtom_id",
    cache: headerMaxAge,
    attribution: "© TomTom",
    free: "Search API : petit quota gratuit (2 500 requêtes, par jour dans l'ancienne offre, par mois dans la nouvelle ; Places API « Discover » : 5 000 / mois). Vérifie ton offre dans le portail TomTom.",
    storageNote: "Conditions TomTom : mise en cache seulement autant que les en-têtes de réponse l'autorisent, pas de base de données dérivée : le CRM ne garde que l'identifiant et ce que tu ajoutes. Attribution « © TomTom ».",
    keyHelp: "developer.tomtom.com → Dashboard → Keys → TOMTOM_API_KEY=… dans .env",
    termHelp: "nom de catégorie en anglais (ex. dentist) ou identifiant numérique de catégorie (categorySet)",
    search: (q, key) => {
      const p = new URLSearchParams({ key, lat: String(q.lat), lon: String(q.lng), radius: String(Math.min(50_000, q.radius)), limit: String(Math.min(100, q.limit)), countrySet: "MX", language: "es-419" });
      let term = q.term;
      if (/^\d{4,8}$/.test(term)) { p.set("categorySet", term); term = "poi"; }
      return { url: `https://api.tomtom.com/search/2/categorySearch/${encodeURIComponent(term)}.json?${p}`, init: {}, parse: (j) => arr(obj(j).results).map(tomtomPlace) };
    },
    details: (id, key) => ({ url: "https://api.tomtom.com/search/2/place.json?" + new URLSearchParams({ entityId: id, key, language: "es-419" }), init: {}, parse: (j) => { const r = arr(obj(j).results)[0]; return r ? tomtomPlace(r) : null; } }),
  },
  google: {
    key: "google", label: "Google Places", env: "GOOGLE_PLACES_KEY", defaultCap: 4500, idCol: "google_place_id",
    cache: () => 0,
    attribution: "Données Google Maps",
    free: "Depuis mars 2025 : quota gratuit par SKU et par mois — Text Search « Pro » 5 000 ; avec téléphone et site (« Enterprise ») 1 000. Le plafond par défaut reste sous ces quotas (4 500, ou 900 avec téléphone et site).",
    storageNote: "Conditions Google Maps Platform : seul l'identifiant place_id peut être gardé ; le contenu (nom, téléphone, avis…) ne doit pas être mis en cache ni stocké. Attribution Google sur les données affichées.",
    keyHelp: "console.cloud.google.com → API « Places API (New) » activée → Identifiants → clé restreinte à cette API → GOOGLE_PLACES_KEY=… dans .env",
    termHelp: "texte de recherche (ex. dentista) ; la zone est ajoutée automatiquement",
    search: (q, key) => ({
      url: "https://places.googleapis.com/v1/places:searchText",
      init: { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": GOOGLE_FIELDS().map((f) => "places." + f).join(",") },
        body: JSON.stringify({ textQuery: q.term, languageCode: "es", regionCode: "MX", pageSize: Math.min(20, q.limit), locationBias: { circle: { center: { latitude: q.lat, longitude: q.lng }, radius: Math.min(50_000, q.radius) } } }) },
      parse: (j) => arr(obj(j).places).map(googlePlace),
    }),
    details: (id, key) => ({ url: `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, init: { headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": GOOGLE_FIELDS().join(",") } }, parse: (j) => (obj(j).id ? googlePlace(j) : null) }),
  },
};

// ---------- Clés, plafonds, compteurs, mode de stockage ----------
const keyOf = (p: ApiKey) => (process.env[PROVIDERS[p].env] ?? "").trim();
export const apiEnabled = (p: ApiKey) => /^[\w.~:-]{16,200}$/.test(keyOf(p));
const month = () => today().slice(0, 7);
export const apiUsage = (p: ApiKey) => (db.prepare("SELECT n FROM api_usage WHERE provider = ? AND month = ?").get(p, month()) as { n: number } | undefined)?.n ?? 0;
const jsonSetting = (k: "api_caps" | "api_storage"): Record<string, unknown> => { try { return obj(JSON.parse(getSetting(k) || "{}")); } catch { return {}; } };
/** Plafond Google avec téléphone/site (SKU Enterprise : 1 000 gratuits / mois). */
export const GOOGLE_RICH_CAP = 900;
export const apiCap = (p: ApiKey) => {
  const raw = jsonSetting("api_caps")[p], v = Number(raw);
  if (raw !== undefined && raw !== null && raw !== "" && Number.isInteger(v) && v >= 0) return v;
  return p === "google" && googleRich() ? GOOGLE_RICH_CAP : PROVIDERS[p].defaultCap;
};
export const apiStorage = (p: ApiKey): Storage => (jsonSetting("api_storage")[p] === "full" ? "full" : "id");
export function saveApiSettings(p: ApiKey, o: { cap?: number; storage?: Storage; googleRich?: boolean }) {
  if (o.cap !== undefined) { const c = jsonSetting("api_caps"); c[p] = Math.max(0, Math.min(1_000_000, Math.floor(o.cap))); setSetting("api_caps", JSON.stringify(c)); }
  if (o.storage !== undefined) { const st = jsonSetting("api_storage"); st[p] = o.storage; setSetting("api_storage", JSON.stringify(st)); }
  if (o.googleRich !== undefined && p === "google") {
    setSetting("api_google_rich", o.googleRich ? "1" : "0");
    // Champs « Enterprise » : quota gratuit plus petit → on redescend un plafond trop haut (jamais de hausse auto).
    if (o.googleRich && o.cap === undefined && apiCap("google") > GOOGLE_RICH_CAP) saveApiSettings("google", { cap: GOOGLE_RICH_CAP });
  }
}
export const googleRichFields = googleRich;

/** Réserve `n` appels : refus (sans appel réseau) si le plafond du mois serait dépassé. */
function reserve(p: ApiKey, n = 1) {
  const used = apiUsage(p), cap = apiCap(p);
  if (used + n > cap) throw new ApiError(`Plafond mensuel ${PROVIDERS[p].label} atteint (${used.toLocaleString("fr-FR")} / ${cap.toLocaleString("fr-FR")} appels ce mois-ci). Augmente-le dans Réglages › Sources & clés si ton offre le permet.`, "cap");
}
/** Un appel hors recherche (ex. « Vérifier sur Google ») : plafond vérifié puis compté. */
export function reserveAndCount(p: ApiKey) { reserve(p); count(p); }
const count = (p: ApiKey) => db.prepare("INSERT INTO api_usage(provider, month, n) VALUES(?, ?, 1) ON CONFLICT(provider, month) DO UPDATE SET n = n + 1").run(p, month());

function humanHttp(p: ApiKey, status: number, body: string): string {
  const L = PROVIDERS[p].label;
  if (status === 401 || status === 403) return `${L} refuse la clé (${status}) : vérifie-la dans .env et que l'API est activée pour ce compte.`;
  if (status === 429) return `${L} : trop de requêtes ou quota de ton compte dépassé. Réessaie plus tard.`;
  if (status >= 500) return `${L} est indisponible pour le moment. Réessaie dans quelques minutes.`;
  return `${L} a refusé la recherche (erreur ${status}${body ? " : " + body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 120) : ""}).`;
}

async function call(p: ApiKey, req: { url: string; init: RequestInit }): Promise<{ json: unknown; res: Response }> {
  reserve(p);
  count(p);                                      // compté avant l'appel : un appel parti est facturé même en erreur
  let res: Response;
  try { res = await T.f(req.url, { ...req.init, signal: AbortSignal.timeout(20_000), cache: "no-store" }); }
  catch { throw new ApiError(`${PROVIDERS[p].label} injoignable (réseau) : réessaie plus tard.`, "network"); }
  const text = await res.text();
  if (!res.ok) throw new ApiError(humanHttp(p, res.status, text), "http");
  try { return { json: JSON.parse(text), res }; } catch { throw new ApiError(`${PROVIDERS[p].label} : réponse illisible.`, "http"); }
}

/** Recherche de lieux (cache si les conditions le permettent). `cached` : aucun appel compté. */
export async function apiSearch(p: ApiKey, q: SearchQuery): Promise<{ places: ApiPlace[]; cached: boolean }> {
  if (!apiEnabled(p)) throw new ApiError(`${PROVIDERS[p].label} : clé requise (${PROVIDERS[p].env} dans .env). Rien n'a été envoyé.`, "nokey");
  const prov = PROVIDERS[p];
  const ck = `api:${p}:` + createHash("sha1").update(JSON.stringify(q) + (p === "google" ? String(googleRich()) : "")).digest("hex");
  const c = db.prepare("SELECT body, at FROM http_cache WHERE k = ?").get(ck) as { body: string; at: number } | undefined;
  if (c && Date.now() < c.at) return { places: JSON.parse(c.body), cached: true };
  const req = prov.search(q, keyOf(p));
  const { json, res } = await call(p, req);
  const places = req.parse(json).filter((x) => x.id && x.nom);
  const ttl = prov.cache(res);
  if (ttl > 0) db.prepare("INSERT INTO http_cache(k, body, at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET body=excluded.body, at=excluded.at").run(ck, JSON.stringify(places), Date.now() + ttl);
  return { places, cached: false };
}

/** Détails à jour d'un lieu (affichés, jamais stockés automatiquement). */
export async function apiDetails(p: ApiKey, id: string): Promise<ApiPlace | null> {
  if (!apiEnabled(p)) throw new ApiError(`${PROVIDERS[p].label} : clé requise.`, "nokey");
  const req = PROVIDERS[p].details(id, keyOf(p));
  const { json } = await call(p, req);
  return req.parse(json);
}

/** Lieu → candidat commun (niche = niche cherchée, jamais créée ; zone = celle de la recherche). */
export function toCandidate(p: ApiKey, x: ApiPlace, niche: string): Candidate {
  return {
    source: p, sourceId: x.id, nom: x.nom.slice(0, 300), categorie: x.categorie.slice(0, 120), niche,
    telephone: telNorm(x.telephone) ? x.telephone : "", email: x.email, site_web: x.site_web, facebook: x.facebook, instagram: x.instagram,
    adresse: x.adresse.slice(0, 300), colonia: x.colonia.slice(0, 200), ville: x.ville.slice(0, 200), lat: x.lat, lng: x.lng,
  };
}

/**
 * Mode « identifiant » (par défaut) : ne garde que l'identifiant, le nom confirmé en ajoutant, la niche (du CRM) et la
 * ville de la zone cherchée (paramètres de l'utilisateur). Mode « complet » : catégorie copiée en spécialité si vide.
 */
export function forStorage(c: Candidate, zone: { ville?: string; etat_code?: string; municipio_code?: string }): Candidate {
  if (!API_KEYS.includes(c.source as ApiKey)) return c;
  if (apiStorage(c.source as ApiKey) === "full") return { ...c, specialite: c.categorie };
  return { source: c.source, sourceId: c.sourceId, nom: c.nom, categorie: "", niche: c.niche, telephone: "", email: "", site_web: "", facebook: "", instagram: "",
    adresse: "", colonia: "", ville: zone.ville ?? "", lat: null, lng: null, etat_code: zone.etat_code, municipio_code: zone.municipio_code, restricted: true };
}

export type ApiStatus = { key: ApiKey; label: string; enabled: boolean; env: string; used: number; cap: number; storage: Storage; free: string; storageNote: string; keyHelp: string; termHelp: string; attribution: string; googleRich?: boolean };
export const apiStatus = (): ApiStatus[] => API_KEYS.map((k) => {
  const p = PROVIDERS[k];
  return { key: k, label: p.label, enabled: apiEnabled(k), env: p.env, used: apiUsage(k), cap: apiCap(k), storage: apiStorage(k), free: p.free, storageNote: p.storageNote,
    keyHelp: p.keyHelp, termHelp: p.termHelp, attribution: p.attribution, ...(k === "google" ? { googleRich: googleRich() } : {}) };
});
