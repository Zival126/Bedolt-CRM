// Positions des fiches (sans accès à la base : utilisable côté client et serveur).

export const PRECISIONS = [
  { key: "commerce", label: "commerce", exact: true },
  { key: "adresse", label: "adresse", exact: true },
  { key: "zone", label: "quartier", exact: false },
  { key: "ville", label: "ville", exact: false },
] as const;
export type Precision = (typeof PRECISIONS)[number]["key"];
export const GEO_SOURCES = ["denue", "import", "nominatim", "manuel"] as const;
export type GeoSource = (typeof GEO_SOURCES)[number];

export const isExact = (p: string) => p === "commerce" || p === "adresse";
export function precisionText(p: string): string {
  if (p === "commerce") return "position du commerce";
  if (p === "adresse") return "position de l'adresse";
  if (p === "zone") return "position approximative : quartier";
  if (p === "ville") return "position approximative : centre de la ville";
  return "sans position";
}
export const sourceLabel = (s: string) =>
  ({ denue: "DENUE", import: "import", nominatim: "OpenStreetMap", manuel: "manuelle" } as Record<string, string>)[s] ?? "—";

/** Cadre du Quintana Roo (un peu large) : premier filtre avant la vérification de l'État renvoyé par Nominatim. */
export const QROO_BOX = { south: 17.8, north: 21.7, west: -89.5, east: -86.65 };
export const inQrooBox = (lat: number, lng: number) =>
  lat >= QROO_BOX.south && lat <= QROO_BOX.north && lng >= QROO_BOX.west && lng <= QROO_BOX.east;

/** Vue par défaut de la carte : Cancún – Puerto Morelos – Playa del Carmen. */
export const DEFAULT_BOUNDS: [[number, number], [number, number]] = [[20.60, -87.13], [21.22, -86.76]];

const validPair = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * Coordonnées dans un texte collé : « 21.1619, -86.8515 », ou un lien Google Maps complet
 * (…/place/…/@21.16,-86.85,17z/…!3d21.16!4d-86.85, ?q=21.16,-86.85, ?query=…, ?ll=…, /search/21.16,+-86.85).
 * Les liens courts (maps.app.goo.gl) ne contiennent pas de coordonnées : null (jamais de requête vers Google).
 */
export function parseCoords(raw: string): { lat: number; lng: number } | null {
  let s = String(raw ?? "").trim().slice(0, 3000);
  if (!s) return null;
  try { s = decodeURIComponent(s.replace(/\+/g, " ")); } catch { /* texte brut */ }
  const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
  const tries = [
    new RegExp(`!3d${num}!4d${num}`),                         // position exacte du lieu
    new RegExp(`[?&](?:q|query|ll|destination|center)=${num}\\s*,\\s*${num}`),
    new RegExp(`@${num},${num}`),                              // centre de la vue
    new RegExp(`/(?:place|search|dir)/${num}\\s*,\\s*${num}`),
    new RegExp(`^${num}\\s*[,; ]\\s*${num}$`),                  // « lat, lng » seul
  ];
  for (const re of tries) {
    const m = s.match(re);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (validPair(lat, lng) && !(lat === 0 && lng === 0)) return { lat, lng };
    }
  }
  return null;
}

/** Texte du paramètre query d'un lien Google Maps (nom du commerce tel qu'importé), sinon ''. */
export function mapsQueryText(url: string): string {
  const v = String(url ?? "").trim();
  if (!v) return "";
  try {
    const u = new URL(v);
    if (!/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && !/^maps\.app\.goo\.gl$/i.test(u.hostname)) return "";
    const q = u.searchParams.get("query") ?? u.searchParams.get("q") ?? "";
    if (q && !parseCoords(q)) return q.trim().slice(0, 200);
    const m = u.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/);
    if (m) { const t = decodeURIComponent(m[1].replace(/\+/g, " ")).trim(); if (t && !parseCoords(t)) return t.slice(0, 200); }
  } catch { /* pas une URL */ }
  return "";
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) : même id → même décalage, à chaque fois. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Décalage stable (calculé à partir de l'id) pour que les fiches d'un même quartier / d'une même ville ne se superposent pas. */
export function jitter(id: number, lat: number, lng: number, precision: string): { lat: number; lng: number } {
  const radiusM = precision === "zone" ? 280 : precision === "ville" ? 1400 : 0;
  if (!radiusM) return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
  const r = rng(id * 2654435761);
  const angle = r() * 2 * Math.PI, dist = Math.sqrt(r()) * radiusM;
  const dLat = (dist * Math.cos(angle)) / 111_320;
  const dLng = (dist * Math.sin(angle)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: Math.round((lat + dLat) * 1e6) / 1e6, lng: Math.round((lng + dLng) * 1e6) / 1e6 };
}

/** Itinéraire Google Maps vers un point. */
export const directionsUrl = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
