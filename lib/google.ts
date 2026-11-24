// Google Places (optionnel, désactivé par défaut) : « Vérifier sur Google » depuis une fiche.
// Aucune requête si GOOGLE_PLACES_KEY est absent de .env. Text Search (New), champs limités au nécessaire
// (facturation « Pro »). Compteur mensuel affiché dans Réglages. La clé n'est jamais envoyée au navigateur.
import { db, now, today } from "./db";
import { telNorm } from "./phone";
import { getBusiness } from "./crm";
import { recordOrigin } from "./sources";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELDS = "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.googleMapsUri,places.businessStatus,places.location";
export const googleEnabled = () => /^[\w-]{20,100}$/.test((process.env.GOOGLE_PLACES_KEY ?? "").trim());
const month = () => today().slice(0, 7);
export const googleUsage = () => (db.prepare("SELECT n FROM google_usage WHERE month = ?").get(month()) as { n: number } | undefined)?.n ?? 0;

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const G = globalThis as unknown as { __gfetch?: { f: Fetcher } };
const T = G.__gfetch ?? (G.__gfetch = { f: (u, i) => fetch(u, i) });
export function setGoogleFetch(f: Fetcher | null) { T.f = f ?? ((u, i) => fetch(u, i)); }

export type GooglePlace = { id: string; name: string; address: string; rating: number | null; reviews: number | null; website: string; phone: string; maps: string; status: string };
export type GoogleCheck = { found: boolean; place: GooglePlace | null; filled: string[]; message: string };

export async function checkOnGoogle(id: number): Promise<GoogleCheck> {
  if (!googleEnabled()) throw new Error("Google Places désactivé : ajoute GOOGLE_PLACES_KEY dans .env puis redémarre.");
  const b = getBusiness(id);
  if (!b) throw new Error("Commerce introuvable.");
  const body: Record<string, unknown> = { textQuery: [b.nom, b.colonia, b.ville || "Quintana Roo"].filter(Boolean).join(" ").slice(0, 200), languageCode: "es", regionCode: "MX", pageSize: 3 };
  if (b.lat != null && b.lng != null) body.locationBias = { circle: { center: { latitude: b.lat, longitude: b.lng }, radius: 2000 } };
  db.prepare("INSERT INTO google_usage(month, n) VALUES(?, 1) ON CONFLICT(month) DO UPDATE SET n = n + 1").run(month());
  let res: Response;
  try {
    res = await T.f(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_PLACES_KEY!.trim(), "X-Goog-FieldMask": FIELDS },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), cache: "no-store" });
  } catch { throw new Error("Google Places injoignable."); }
  const j = await res.json().catch(() => ({})) as { places?: Record<string, unknown>[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`Google Places : ${(j.error?.message ?? `erreur ${res.status}`).slice(0, 160)}`);
  const p = j.places?.[0];
  db.prepare("UPDATE businesses SET google_at = ? WHERE id = ?").run(now(), id);
  if (!p) return { found: false, place: null, filled: [], message: "Aucune fiche Google trouvée pour ce nom." };
  const place: GooglePlace = {
    id: String(p.id ?? ""), name: String((p.displayName as { text?: string })?.text ?? ""), address: String(p.formattedAddress ?? ""),
    rating: typeof p.rating === "number" ? p.rating : null, reviews: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    website: String(p.websiteUri ?? ""), phone: String(p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? ""), maps: String(p.googleMapsUri ?? ""), status: String(p.businessStatus ?? ""),
  };
  // Fiche Google trouvée : existence, note et avis mis à jour ; site / téléphone / lien seulement s'ils manquent
  const sets: Record<string, unknown> = { fiche_google: b.fiche_google === "vide" ? "vide" : "oui", google_place_id: place.id };
  const filled: string[] = [];
  const origin = `Google Places · ${today()}`;
  if (place.rating != null) { sets.note_google = place.rating; filled.push("note"); }
  if (place.reviews != null) { sets.nb_avis = place.reviews; filled.push("avis"); }
  if (!b.site_web && /^https?:\/\//.test(place.website)) { sets.site_web = place.website; filled.push("site"); recordOrigin(id, "site_web", place.website, origin); }
  if (!b.tel_norm && telNorm(place.phone)) { sets.telephone = place.phone; sets.tel_norm = telNorm(place.phone); filled.push("téléphone"); recordOrigin(id, "telephone", place.phone, origin); }
  if (!b.lien_google && /^https:\/\//.test(place.maps)) { sets.lien_google = place.maps; filled.push("lien Maps"); }
  const k = Object.keys(sets);
  db.prepare(`UPDATE businesses SET ${k.map((x) => `${x} = ?`).join(", ")} WHERE id = ?`).run(...k.map((x) => sets[x]), id);
  return { found: true, place, filled, message: `Fiche Google trouvée : ${place.name}${place.rating != null ? ` · ${place.rating}★ (${place.reviews ?? 0} avis)` : ""}${place.status && place.status !== "OPERATIONAL" ? ` · ${place.status}` : ""}.` };
}
