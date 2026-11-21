// Filtres de liste lus depuis l'URL (?statut=…&niche=…) : validés, bornés, et réécrits dans les liens.
import { STATUTS } from "./constants";
import { SORTS, type Filters } from "./crm";

export type SP = Record<string, string | string[] | undefined>;
export const FILTER_KEYS = ["q", "statut", "niche", "zone", "offre", "ville", "fiche", "web", "note_min", "avis_min", "lot", "msg", "activite"] as const;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 200);

/**
 * Vue « À appeler » (par défaut, sans paramètre vue) : statut À contacter et tri offre puis nb d'avis, sauf si l'URL
 * précise statut / sort. Vue « toutes » : aucun filtre implicite, tri par date d'ajout.
 */
export function readFilters(sp: SP) {
  const vue = one(sp.vue) === "toutes" ? "toutes" : "appeler";
  const f: Filters = {};
  for (const k of FILTER_KEYS) { const v = one(sp[k])?.trim(); if (v) f[k] = v; }
  const statutParam = one(sp.statut);
  if (f.statut && !STATUTS.some((s) => s.key === f.statut)) delete f.statut;
  if (vue === "appeler" && statutParam === undefined) f.statut = "a_contacter";
  const sort = one(sp.sort);
  f.sort = SORTS.some((s) => s.key === sort) ? sort : vue === "appeler" ? "offre" : "recent";
  const page = Math.max(1, Math.min(10_000, Number(one(sp.page)) || 1));
  return { vue, f, page, statutExplicit: statutParam !== undefined };
}

/** Lien vers la même liste avec des paramètres modifiés (undefined/'' = retiré). La page revient à 1 sauf si fournie. */
export function hrefWith(base: string, sp: SP, changes: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) { const x = one(v); if (x !== undefined && k !== "page") p.set(k, x); }
  for (const [k, v] of Object.entries(changes)) { if (v === undefined) p.delete(k); else p.set(k, v); }
  if (p.get("page") === "1") p.delete("page");
  const s = p.toString();
  return base + (s ? "?" + s : "");
}

/** Chaîne de requête canonique d'un filtre (actions groupées « toutes les fiches du filtre »). */
export function filterQuery(f: Filters) {
  const p = new URLSearchParams({ vue: "toutes" });
  for (const k of FILTER_KEYS) if (f[k]) p.set(k, f[k]!);
  if (f.sort) p.set("sort", f.sort);
  return p.toString();
}
