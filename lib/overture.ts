// Recherche dans les lieux Overture Maps chargés localement (table overture_places, scripts/overture-sync.sh).
// Aucune requête réseau ici. Données © Overture Maps Foundation (CDLA Permissive 2.0 / ODbL selon les sources).
import { db } from "./db";
import { nicheResolver } from "./category-map";
import type { Candidate } from "./sources";
import type { Bbox } from "./osm";

export type OvertureQuery = {
  categories: string[]; niche?: string; bbox?: Bbox; locality?: string; q?: string;
  tel?: boolean; site?: boolean; social?: boolean; email?: boolean; minConfidence?: number; excludeClosed?: boolean; limit?: number;
};
type Row = { id: string; name: string; category: string; basic_category: string; categories: string; phones: string; websites: string; socials: string; emails: string;
  address: string; locality: string; postcode: string; confidence: number | null; operating_status: string; lat: number | null; lng: number | null };

export const overtureMeta = () => Object.fromEntries((db.prepare("SELECT k, v FROM overture_meta").all() as { k: string; v: string }[]).map((r) => [r.k, r.v])) as Record<string, string>;
export const overtureCount = () => (db.prepare("SELECT COUNT(*) n FROM overture_places").get() as { n: number }).n;

/** Catégories présentes localement, avec leur nombre (sélecteur de l'onglet Overture). */
export const overtureCategories = (limit = 300) =>
  db.prepare("SELECT category c, COUNT(*) n FROM overture_places WHERE category != '' GROUP BY category ORDER BY n DESC LIMIT ?").all(limit) as { c: string; n: number }[];

const arr = (s: string): string[] => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };

export function searchOverture(q: OvertureQuery): { candidates: (Candidate & { confidence: number | null; closed: boolean })[]; total: number } {
  const w: string[] = [], args: unknown[] = [];
  const cats = q.categories.filter((c) => /^[a-z0-9_]{2,80}$/.test(c)).slice(0, 80);
  // Niche choisie : catégories qui y correspondent (règles + surcharges)
  if (q.niche) {
    const resolve = nicheResolver("overture");
    const all = (db.prepare("SELECT DISTINCT category c FROM overture_places WHERE category != ''").all() as { c: string }[]).map((r) => r.c);
    cats.push(...all.filter((c) => resolve([c]) === q.niche));
  }
  if (cats.length) { w.push(`(category IN (${cats.map(() => "?").join(",")}) OR basic_category IN (${cats.map(() => "?").join(",")}))`); args.push(...cats, ...cats); }
  else if (!q.q) w.push("0");
  if (q.bbox) { w.push("lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?"); args.push(q.bbox.s, q.bbox.n, q.bbox.w, q.bbox.e); }
  if (q.locality) { w.push("locality = ? COLLATE NOCASE"); args.push(q.locality); }
  if (q.q) { w.push("name LIKE ?"); args.push(`%${q.q.replace(/[%_]/g, "")}%`); }
  if (q.tel) w.push("phones != '[]'");
  if (q.site) w.push("websites != '[]'");
  if (q.social) w.push("socials != '[]'");
  if (q.email) w.push("emails != '[]'");
  if (q.minConfidence) { w.push("COALESCE(confidence, 0) >= ?"); args.push(q.minConfidence); }
  if (q.excludeClosed) w.push("operating_status NOT IN ('permanently_closed', 'temporarily_closed', 'closed')");
  const where = w.length ? "WHERE " + w.join(" AND ") : "";
  const total = (db.prepare(`SELECT COUNT(*) n FROM overture_places ${where}`).get(...args) as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM overture_places ${where} ORDER BY confidence DESC LIMIT ?`).all(...args, Math.min(q.limit ?? 2000, 5000)) as Row[];
  const resolve = nicheResolver("overture");
  return {
    total,
    candidates: rows.map((r) => {
      const socials = arr(r.socials);
      const cs = [r.category, ...r.categories.split(","), r.basic_category];
      return {
        source: "overture" as const, sourceId: r.id, nom: r.name, categorie: r.category || r.basic_category, niche: resolve(cs),
        telephone: arr(r.phones)[0] ?? "", email: (arr(r.emails)[0] ?? "").toLowerCase(), site_web: normSite(arr(r.websites)[0] ?? ""),
        facebook: socials.find((s) => /facebook\.com/i.test(s)) ?? "", instagram: socials.find((s) => /instagram\.com/i.test(s)) ?? "", tiktok: socials.find((s) => /tiktok\.com/i.test(s)) ?? "",
        adresse: r.address, colonia: "", ville: r.locality, lat: r.lat, lng: r.lng, confidence: r.confidence,
        closed: /closed/.test(r.operating_status),
      };
    }),
  };
}

const normSite = (s: string) => { const v = s.trim(); if (!v) return ""; return /^https?:\/\//i.test(v) ? v : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) ? "https://" + v : ""; };
