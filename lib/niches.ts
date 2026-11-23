// « Mes niches » (Réglages > DENUE) : libellé de niche du CRM → codes SCIAN. Sert à remplir la niche à l'ajout depuis
// DENUE, au tableau « Marché » et aux recherches rapides. Valeurs par défaut construites depuis le catalogue officiel
// (titres SCIAN 2023), jamais saisies de mémoire.
import { z } from "zod";
import { getSetting, setSetting } from "./settings";
import { catalog, fold, dedupeCodes } from "./scian";

export const NicheSchema = z.object({
  label: z.string().trim().min(1).max(100),
  codes: z.array(z.string().regex(/^\d{2,6}$/, "code SCIAN : 2 à 6 chiffres")).min(1).max(60),
});
export const NichesSchema = z.array(NicheSchema).max(40);
export type Niche = z.infer<typeof NicheSchema>;

/** Niches par défaut : classes du catalogue dont le titre commence par ces mots (sans accents). */
const DEFAULTS: [string, RegExp][] = [
  ["Beauté & coiffure", /^salones y clinicas de belleza/],
  ["Restaurants & cafés", /^(restaurantes|cafeterias)/],
  ["Bars", /^bares cantinas/],
  ["Dentistes", /^consultorios dentales del sector privado/],
  ["Salles de sport", /^centros de acondicionamiento fisico del sector privado/],
  ["Vétérinaires", /^servicios veterinarios para mascotas prestados por el sector privado/],
];

export function defaultNiches(): Niche[] {
  const c = catalog();
  return DEFAULTS.map(([label, re]) => ({ label, codes: c.entries.filter((e) => e.l === 6 && re.test(fold(e.t))).map((e) => e.c) }))
    .filter((n) => n.codes.length);
}

export function niches(): Niche[] {
  const raw = getSetting("denue_niches");
  if (!raw) return defaultNiches();
  try {
    const r = NichesSchema.safeParse(JSON.parse(raw));
    if (r.success) return r.data;
  } catch { /* illisible */ }
  return defaultNiches();
}
export const saveNiches = (n: Niche[]) => setSetting("denue_niches", JSON.stringify(n.map((x) => ({ label: x.label, codes: dedupeCodes(x.codes) }))));

/** Niche d'une classe d'activité : la plus précise des niches dont un code couvre la classe. */
export function nicheFor(classe: string, list = niches()): string {
  if (!classe) return "";
  let best = "", len = 0;
  for (const n of list) for (const c of n.codes) if (classe.startsWith(c) && c.length > len) { best = n.label; len = c.length; }
  return best;
}
