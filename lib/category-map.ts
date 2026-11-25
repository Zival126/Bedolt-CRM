// Catégorie d'une source (tag OSM, catégorie Overture) → niche du CRM, d'après les correspondances de la page Niches
// (table niche_maps). OSM : tag exact « clé=valeur ». Overture : catégorie exacte ou motif avec « * ».
// Une valeur préfixée de « ! » exclut cette catégorie de la niche. À égalité, la correspondance la plus précise gagne
// (exacte, puis motif le plus long).
import { db } from "./db";
import { allNiches, globMatch, matchNicheText, nicheForClasse, bumpNicheOps, type NicheRow } from "./niches";

export type MapSource = "osm" | "overture";

/** Tags OSM proposés dans l'éditeur de niche (clé=valeur). */
export const OSM_CATEGORIES: string[] = [
  "shop=beauty", "shop=hairdresser", "shop=massage", "shop=cosmetics", "shop=tattoo", "leisure=spa", "amenity=spa",
  "amenity=dentist", "healthcare=dentist", "amenity=clinic", "amenity=doctors", "healthcare=physiotherapist", "amenity=pharmacy",
  "amenity=restaurant", "amenity=fast_food", "amenity=cafe", "amenity=ice_cream", "shop=bakery", "shop=pastry",
  "amenity=bar", "amenity=pub", "amenity=nightclub",
  "leisure=fitness_centre", "leisure=sports_centre", "amenity=veterinary", "shop=pet", "shop=pet_grooming",
  "shop=clothes", "shop=shoes", "shop=jewelry", "shop=optician", "shop=florist", "shop=car_repair", "shop=car", "craft=photographer",
  "tourism=hotel", "tourism=guest_house", "office=estate_agent", "office=lawyer", "amenity=school", "amenity=language_school",
];

function score(pattern: string, cat: string): number {
  if (pattern === cat) return 1000;
  return pattern.includes("*") && globMatch(pattern, cat) ? pattern.replace(/\*/g, "").length : 0;
}

/** Niche la plus précise pour une catégorie, ou null. */
export function matchCategory(source: MapSource, cat: string, list: NicheRow[]): NicheRow | null {
  let best: NicheRow | null = null, s = 0;
  for (const n of list) {
    const vals = n[source];
    if (vals.some((v) => v.startsWith("!") && score(v.slice(1), cat) > 0)) continue;
    for (const v of vals) { if (v.startsWith("!")) continue; const x = score(v, cat); if (x > s) { s = x; best = n; } }
  }
  return best;
}

/** Résolveur : catégories d'un lieu (dans l'ordre) → libellé de niche ('' si aucune). Une lecture des niches. */
export function nicheResolver(source: MapSource) {
  const list = allNiches();
  return (cats: string[]): string => {
    for (const c of cats) { if (!c) continue; const n = matchCategory(source, c, list); if (n) return n.label; }
    return "";
  };
}

/** Préréglages OSM : niche → tags OSM. */
export function osmPresets(): { id: number; niche: string; color: string; icon: string; tags: string[] }[] {
  return allNiches().map((n) => ({ id: n.id, niche: n.label, color: n.color, icon: n.icon, tags: n.osm.filter((t) => !t.startsWith("!")) })).filter((x) => x.tags.length);
}

/**
 * Fiches sans niche : niche proposée d'après ce que l'on sait déjà (catégorie OSM / Overture de l'activité, classe SCIAN
 * contenue dans l'identifiant DENUE, mots-clés). `apply` : attribue réellement. Renvoie le nombre reconnu.
 */
export function autoAssign(apply: boolean): { matched: number; byNiche: Record<number, number> } {
  const list = allNiches();
  const rows = db.prepare("SELECT id, activite, denue_id, sources FROM businesses WHERE niche_id IS NULL").all() as { id: number; activite: string; denue_id: string; sources: string }[];
  const st = db.prepare("UPDATE businesses SET niche_id = ?, niche = ? WHERE id = ? AND niche_id IS NULL");
  const byNiche: Record<number, number> = {};
  let matched = 0;
  if (apply) bumpNicheOps();
  db.transaction(() => {
    for (const r of rows) {
      const a = (r.activite ?? "").trim();
      const n = (a.includes("=") ? matchCategory("osm", a, list) : null)
        ?? (/^[a-z0-9_]+$/.test(a) ? matchCategory("overture", a, list) : null)
        ?? (/^\d{11}/.test(r.denue_id ?? "") ? nicheForClasse(r.denue_id.slice(5, 11), list) : null)
        ?? (a ? matchNicheText(a, list) : null);
      if (!n) continue;
      matched++; byNiche[n.id] = (byNiche[n.id] ?? 0) + 1;
      if (apply) st.run(n.id, n.label, r.id);
    }
  })();
  return { matched, byNiche };
}
