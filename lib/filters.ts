// Filtres de liste lus depuis l'URL (?statut=…&niche=…) : validés, bornés, et réécrits dans les liens.
import { STATUTS } from "./constants";
import { SORTS, type Filters } from "./crm";

export type SP = Record<string, string | string[] | undefined>;
export const FILTER_KEYS = ["q", "statut", "niche", "zone", "offre", "ville", "fiche", "web", "note_min", "avis_min", "lot", "msg", "activite", "nowa", "file"] as const;
export const VUES = [
  { key: "contacter", label: "À contacter", href: "/commerces" },
  { key: "appeler", label: "À appeler", href: "/commerces?vue=appeler" },
  { key: "perdues", label: "Perdues", href: "/commerces?vue=perdues" },
  { key: "toutes", label: "Toutes", href: "/commerces?vue=toutes" },
] as const;
export type Vue = (typeof VUES)[number]["key"];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 200);

/**
 * Vues de la liste des commerces (le statut / tri explicites de l'URL priment) :
 * - « À contacter » (défaut) : statut À contacter, tri offre puis nb d'avis ;
 * - « À appeler » : numéros sans WhatsApp (ni perdus ni payés), même tri ;
 * - « Perdues » : statut Perdu (consultables et réactivables), récentes d'abord ;
 * - « Toutes » : aucun filtre implicite, tri par date d'ajout.
 */
export function readFilters(sp: SP) {
  const v = one(sp.vue);
  const vue: Vue = VUES.some((x) => x.key === v) ? (v as Vue) : "contacter";
  const f: Filters = {};
  for (const k of FILTER_KEYS) { const x = one(sp[k])?.trim(); if (x) f[k] = x; }
  const statutParam = one(sp.statut);
  if (f.statut && f.statut !== "actifs" && !STATUTS.some((s) => s.key === f.statut)) delete f.statut;
  if (f.file && f.file !== "1") delete f.file;
  if (statutParam === undefined) {
    if (vue === "contacter") f.statut = "a_contacter";
    if (vue === "perdues") f.statut = "perdu";
  }
  if (vue === "appeler") f.nowa = "1";
  if (f.nowa && f.nowa !== "1") delete f.nowa;
  const sort = one(sp.sort);
  f.sort = SORTS.some((s) => s.key === sort) ? sort : vue === "contacter" || vue === "appeler" ? "offre" : "recent";
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

/**
 * Filtres de la carte : mêmes clés que Commerces (gardées dans l'URL), sans pagination ni tri.
 * Statut absent : toutes les fiches sauf Perdu (« actifs ») ; « tous » : y compris Perdu.
 */
export function readMapFilters(sp: SP): Filters {
  const f: Filters = {};
  for (const k of FILTER_KEYS) { const x = one(sp[k])?.trim(); if (x) f[k] = x; }
  delete f.nowa; delete f.activite;
  const st = one(sp.statut);
  if (!st) f.statut = "actifs";
  else if (st === "tous") delete f.statut;
  else if (st !== "actifs" && !STATUTS.some((s) => s.key === st)) f.statut = "actifs";
  if (f.file && f.file !== "1") delete f.file;
  for (const k of ["note_min", "avis_min", "lot"] as const) if (f[k] && !Number.isFinite(Number(f[k]))) delete f[k];
  return f;
}

/** Chaîne de requête d'un filtre de carte (liens « Voir en liste » / « Mode focus », appel de l'API des points). */
export function mapQuery(f: Filters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams(extra);
  for (const k of FILTER_KEYS) if (f[k]) p.set(k, f[k]!);
  if (!f.statut) p.set("statut", "tous");
  return p.toString();
}
