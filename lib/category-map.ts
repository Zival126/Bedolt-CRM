// Correspondance catégorie d'une source → niche du CRM (« Mes niches »).
// Règles par défaut ci-dessous (catégories publiques OSM / Overture, pas des codes SCIAN), surchargées par la table
// category_map (Réglages > Sources). Les préréglages OSM par niche = catégories OSM qui pointent vers cette niche.
import { db } from "./db";
import { niches } from "./niches";

export type MapSource = "osm" | "overture";

/** Catégories OSM proposées (clé=valeur) et leur niche par défaut. */
export const OSM_CATEGORIES: [string, string][] = [
  ["shop=beauty", "Beauté & coiffure"], ["shop=hairdresser", "Beauté & coiffure"], ["shop=massage", "Beauté & coiffure"],
  ["leisure=spa", "Beauté & coiffure"], ["amenity=spa", "Beauté & coiffure"], ["shop=tattoo", "Beauté & coiffure"],
  ["amenity=dentist", "Dentistes"], ["healthcare=dentist", "Dentistes"],
  ["amenity=restaurant", "Restaurants & cafés"], ["amenity=fast_food", "Restaurants & cafés"], ["amenity=cafe", "Restaurants & cafés"],
  ["amenity=ice_cream", "Restaurants & cafés"], ["shop=bakery", "Restaurants & cafés"],
  ["amenity=bar", "Bars"], ["amenity=pub", "Bars"], ["amenity=nightclub", "Bars"],
  ["leisure=fitness_centre", "Salles de sport"], ["leisure=sports_centre", "Salles de sport"],
  ["amenity=veterinary", "Vétérinaires"], ["shop=pet_grooming", "Vétérinaires"],
];

/** Règles Overture (taxonomie Overture : beauty_salon, nail_salon, dental_clinic…), testées dans l'ordre. */
const OVERTURE_RULES: [RegExp, string][] = [
  [/beauty_salon|hair_salon|nail_salon|barber|eyelash|eyebrow|^spa$|day_spa|medical_spa|massage|waxing|hair_removal|makeup_artist|skin_care|tattoo|personal_or_beauty_service/, "Beauté & coiffure"],
  [/dent|orthodont|endodont|periodont/, "Dentistes"],
  [/restaurant|^cafe$|coffee_shop|bakery|ice_cream|juice_bar|taco|pizza|food_truck|bistro|diner|eatery|cafeteria/, "Restaurants & cafés"],
  [/(^|_)(bar|pub|night_club|cocktail_bar|sports_bar|wine_bar|beer_bar|lounge)$/, "Bars"],
  [/^gym$|fitness|yoga|pilates|crossfit|boxing|martial_arts|sport_or_fitness/, "Salles de sport"],
  [/veterinar|pet_groom|animal_or_pet_service/, "Vétérinaires"],
];
const OSM_DEFAULT = new Map(OSM_CATEGORIES);

function overrides(source: MapSource): Map<string, string> {
  return new Map((db.prepare("SELECT category, niche FROM category_map WHERE source = ?").all(source) as { category: string; niche: string }[]).map((r) => [r.category, r.niche]));
}

/** Niche par défaut d'une catégorie (sans les surcharges). */
export function defaultNiche(source: MapSource, cat: string): string {
  if (source === "osm") return OSM_DEFAULT.get(cat) ?? "";
  return OVERTURE_RULES.find(([re]) => re.test(cat))?.[1] ?? "";
}

/**
 * Niche d'un établissement d'après ses catégories (la 1re qui correspond) : surcharge, sinon règle par défaut.
 * Une niche qui n'existe plus dans « Mes niches » est ignorée.
 */
export function nicheResolver(source: MapSource) {
  const ov = overrides(source);
  const labels = new Set(niches().map((n) => n.label));
  return (cats: string[]): string => {
    for (const c of cats) {
      if (!c) continue;
      const n = ov.has(c) ? ov.get(c)! : defaultNiche(source, c);
      if (n && labels.has(n)) return n;
      if (ov.has(c) && ov.get(c) === "") continue;
    }
    return "";
  };
}

/** Préréglages OSM : niche → catégories OSM (défauts + surcharges). */
export function osmPresets(): { niche: string; tags: string[] }[] {
  const ov = overrides("osm");
  const all = new Set([...OSM_DEFAULT.keys(), ...ov.keys()]);
  const by = new Map<string, string[]>();
  for (const c of all) {
    const n = ov.has(c) ? ov.get(c)! : OSM_DEFAULT.get(c) ?? "";
    if (!n) continue;
    by.set(n, [...(by.get(n) ?? []), c]);
  }
  return niches().map((n) => ({ niche: n.label, tags: by.get(n.label) ?? [] })).filter((x) => x.tags.length);
}

export type MapRow = { category: string; niche: string; isDefault: boolean; count?: number };
/** Tableau éditable : catégories connues (défauts OSM, catégories Overture présentes localement) et leur niche. */
export function mappingTable(source: MapSource): MapRow[] {
  const ov = overrides(source);
  const cats = new Map<string, number | undefined>();
  if (source === "osm") for (const [c] of OSM_CATEGORIES) cats.set(c, undefined);
  else for (const r of db.prepare(`SELECT category c, COUNT(*) n FROM overture_places WHERE category != '' GROUP BY category ORDER BY n DESC LIMIT 150`).all() as { c: string; n: number }[]) cats.set(r.c, r.n);
  for (const c of ov.keys()) if (!cats.has(c)) cats.set(c, undefined);
  return [...cats].map(([category, count]) => ({ category, count, niche: ov.has(category) ? ov.get(category)! : defaultNiche(source, category), isDefault: !ov.has(category) }));
}

export function setMapping(source: MapSource, category: string, niche: string | null) {
  if (niche === null) db.prepare("DELETE FROM category_map WHERE source = ? AND category = ?").run(source, category);
  else db.prepare("INSERT INTO category_map(source, category, niche) VALUES(?,?,?) ON CONFLICT(source, category) DO UPDATE SET niche = excluded.niche").run(source, category, niche);
}
