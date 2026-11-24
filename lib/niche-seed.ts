// Niches par défaut et migration v8 (texte « niche » des fiches → table niches). Reçoit la base en paramètre :
// appelé par lib/db.ts pendant l'ouverture (pas d'import de ./db ici, sinon import circulaire).
import type Database from "better-sqlite3";
import { catalog, fold } from "./scian";
import { PALETTE, nextColor } from "./niche-style";

export type SeedNiche = { label: string; icon: string; scian: RegExp; osm: string[]; overture: string[]; keywords: string[] };

/**
 * Niches proposées au départ. SCIAN : classes du catalogue officiel dont le titre commence par ces mots (jamais saisies de
 * mémoire). OSM : tags publics. Overture : catégories de la taxonomie Overture, « * » = n'importe quels caractères.
 */
export const DEFAULT_NICHES: SeedNiche[] = [
  { label: "Beauté & coiffure", icon: "scissors", scian: /^salones y clinicas de belleza/,
    osm: ["shop=beauty", "shop=hairdresser", "shop=massage", "leisure=spa", "amenity=spa", "shop=tattoo"],
    overture: ["beauty_salon", "hair_salon", "nail_salon", "*barber*", "*eyelash*", "*eyebrow*", "spa", "day_spa", "medical_spa", "*massage*", "*waxing*",
      "*hair_removal*", "makeup_artist", "*skin_care*", "*tattoo*", "personal_or_beauty_service"],
    keywords: ["beaute", "coiffure", "belleza", "estetica", "peluqueria", "salon de belleza", "unas", "nails", "spa", "barberia", "barbier"] },
  { label: "Restaurants & cafés", icon: "utensils", scian: /^(restaurantes|cafeterias)/,
    osm: ["amenity=restaurant", "amenity=fast_food", "amenity=cafe", "amenity=ice_cream", "shop=bakery"],
    overture: ["*restaurant*", "cafe", "coffee_shop", "*bakery*", "*ice_cream*", "*juice_bar*", "*taco*", "*pizza*", "food_truck", "*bistro*", "*diner*", "*eatery*", "*cafeteria*"],
    keywords: ["restaurant", "restaurante", "cafe", "cafeteria", "taqueria", "comida", "panaderia"] },
  { label: "Bars", icon: "glass", scian: /^bares cantinas/,
    osm: ["amenity=bar", "amenity=pub", "amenity=nightclub"],
    overture: ["bar", "*_bar", "pub", "*_pub", "night_club", "*_night_club", "lounge", "*_lounge"],
    keywords: ["bar", "cantina", "antro", "pub"] },
  { label: "Dentistes", icon: "tooth", scian: /^consultorios dentales del sector privado/,
    osm: ["amenity=dentist", "healthcare=dentist"],
    overture: ["*dentist*", "*dental*", "*orthodont*", "*endodont*", "*periodont*"],
    keywords: ["dentiste", "dentista", "dental", "odontologia"] },
  { label: "Salles de sport", icon: "dumbbell", scian: /^centros de acondicionamiento fisico del sector privado/,
    osm: ["leisure=fitness_centre", "leisure=sports_centre"],
    overture: ["gym", "*fitness*", "*yoga*", "*pilates*", "*crossfit*", "*boxing*", "*martial_arts*", "*sport_or_fitness*"],
    keywords: ["gym", "gimnasio", "fitness", "salle de sport", "crossfit", "yoga"] },
  { label: "Vétérinaires", icon: "paw", scian: /^servicios veterinarios para mascotas prestados por el sector privado/,
    osm: ["amenity=veterinary", "shop=pet_grooming"],
    overture: ["*veterinar*", "*pet_groom*", "animal_or_pet_service"],
    keywords: ["veterinaire", "veterinaria", "veterinario", "mascotas"] },
];

/** Codes SCIAN (classes, 6 chiffres) d'une niche par défaut. */
export const seedCodes = (n: SeedNiche) => catalog().entries.filter((e) => e.l === 6 && n.scian.test(fold(e.t))).map((e) => e.c);

/** Correspondance d'une catégorie Overture avec un motif (« * » = n'importe quels caractères). */
export function globMatch(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) return pattern === value;
  const re = new RegExp("^" + pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return re.test(value);
}

/**
 * v7 → v8 (une seule fois, ou si la table est vide) — non destructive :
 * 1. niches depuis « Mes niches » (codes SCIAN, réglage denue_niches) ou les niches par défaut, avec leurs tags OSM /
 *    catégories Overture / mots-clés par défaut ;
 * 2. surcharges de la « correspondance catégories → niches » (table category_map) reprises : catégorie déplacée ou
 *    exclue (« ! ») ;
 * 3. une niche par valeur texte distincte des fiches (casse / accents regroupés), couleurs distinctes ; chaque variante
 *    devient un mot-clé reconnu à l'import ;
 * 4. niche_id renseigné sur toutes les fiches ; filtre de la file (Réglages) converti en identifiants.
 */
export function migrateV8(d: Database.Database) {
  const now = new Date().toISOString();
  const byFold = new Map<string, number>();
  const colors: string[] = [];
  for (const r of d.prepare("SELECT id, label, color FROM niches").all() as { id: number; label: string; color: string }[]) { byFold.set(fold(r.label), r.id); colors.push(r.color); }
  const insN = d.prepare("INSERT INTO niches(label, color, icon, position, created_at) VALUES(?,?,?,?,?)");
  const insM = d.prepare("INSERT OR IGNORE INTO niche_maps(niche_id, kind, value) VALUES(?,?,?)");
  let pos = (d.prepare("SELECT COALESCE(MAX(position), 0) p FROM niches").get() as { p: number }).p;
  const create = (label: string, icon = "tag"): number => {
    const k = fold(label);
    const ex = byFold.get(k);
    if (ex) return ex;
    const color = colors.length < PALETTE.length ? PALETTE[colors.length][0] : nextColor(colors);
    colors.push(color);
    const id = Number(insN.run(label.slice(0, 100), color, icon, ++pos, now).lastInsertRowid);
    byFold.set(k, id);
    return id;
  };
  const seedOf = (label: string) => DEFAULT_NICHES.find((n) => fold(n.label) === fold(label));

  // 1. « Mes niches » (SCIAN)
  let mine: { label: string; codes: string[] }[] | null = null;
  try {
    const raw = (d.prepare("SELECT value FROM settings WHERE key = 'denue_niches'").get() as { value: string } | undefined)?.value;
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) mine = v.filter((x) => x && typeof x.label === "string" && Array.isArray(x.codes)); }
  } catch { mine = null; }
  const base = mine ?? DEFAULT_NICHES.map((n) => ({ label: n.label, codes: seedCodes(n) }));
  for (const n of base) {
    if (!n.label.trim()) continue;
    const s = seedOf(n.label);
    const id = create(n.label.trim(), s?.icon);
    for (const c of n.codes) if (/^\d{2,6}$/.test(String(c))) insM.run(id, "scian", String(c));
    if (s) {
      for (const t of s.osm) insM.run(id, "osm", t);
      for (const t of s.overture) insM.run(id, "overture", t);
      for (const t of s.keywords) insM.run(id, "keyword", fold(t));
    }
  }

  // 2. Surcharges catégorie → niche
  const hasCatMap = d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='category_map'").get();
  if (hasCatMap) {
    const maps = () => d.prepare("SELECT niche_id, value FROM niche_maps WHERE kind = ?");
    for (const o of d.prepare("SELECT source, category, niche FROM category_map").all() as { source: string; category: string; niche: string }[]) {
      if (o.source !== "osm" && o.source !== "overture") continue;
      const others = (maps().all(o.source) as { niche_id: number; value: string }[]).filter((m) => !m.value.startsWith("!") && globMatch(m.value, o.category));
      const target = o.niche.trim() ? create(o.niche.trim()) : null;
      for (const m of others) {
        if (m.niche_id === target) continue;
        if (m.value === o.category) d.prepare("DELETE FROM niche_maps WHERE niche_id = ? AND kind = ? AND value = ?").run(m.niche_id, o.source, m.value);
        else insM.run(m.niche_id, o.source, "!" + o.category);
      }
      if (target) insM.run(target, o.source, o.category);
    }
  }

  // 3. Valeurs texte des fiches
  const vals = d.prepare("SELECT niche v, COUNT(*) n FROM businesses WHERE COALESCE(niche, '') != '' GROUP BY niche ORDER BY n DESC").all() as { v: string; n: number }[];
  const groups = new Map<string, { v: string; n: number }[]>();
  for (const r of vals) { const k = fold(r.v); if (!k) continue; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const setB = d.prepare("UPDATE businesses SET niche_id = ?, niche = ? WHERE niche = ?");
  const caps = (v: string) => v === v.toUpperCase() || v === v.toLowerCase();
  for (const [k, list] of groups) {
    // Libellé : la variante la plus fréquente, en préférant une casse normale (« Barbiers » plutôt que « BARBIERS »)
    const best = [...list].sort((a, b) => b.n - a.n || Number(caps(a.v)) - Number(caps(b.v)))[0];
    const id = byFold.get(k) ?? create(best.v.trim(), seedOf(best.v)?.icon);
    const label = (d.prepare("SELECT label FROM niches WHERE id = ?").get(id) as { label: string }).label;
    insM.run(id, "keyword", k);
    for (const r of list) setB.run(id, label, r.v);
  }

  // 4. Filtre de la file : libellés → identifiants (0 = sans niche)
  try {
    const row = d.prepare("SELECT value FROM settings WHERE key = 'objectives'").get() as { value: string } | undefined;
    if (row) {
      const o = JSON.parse(row.value);
      if (o?.filter && Array.isArray(o.filter.niches) && !Array.isArray(o.filter.nicheIds)) {
        o.filter.nicheIds = (o.filter.niches as string[]).map((l) => (l === "" ? 0 : byFold.get(fold(l)) ?? -1)).filter((x) => x >= 0);
        delete o.filter.niches;
        d.prepare("UPDATE settings SET value = ? WHERE key = 'objectives'").run(JSON.stringify(o));
      }
    }
  } catch { /* réglage illisible : valeurs par défaut */ }
}
