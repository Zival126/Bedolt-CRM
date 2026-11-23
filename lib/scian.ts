// Catalogue SCIAN México 2023 (INEGI), lu depuis config/scian-2023.json (généré par scripts/build-catalogs.mjs).
// Recherche par mot-clé en espagnol (titres + index officiel des biens et services) et en français (traduction des mots
// de recherche vers l'espagnol ci-dessous : ce sont des mots, jamais des codes).
import fs from "node:fs";
import path from "node:path";

export type ScianEntry = { c: string; t: string; l: number };
type Catalog = { _source: string; _date: string; entries: ScianEntry[]; products: Record<string, string> };

const g = globalThis as unknown as { __scian?: Catalog & { byCode: Map<string, ScianEntry>; idx: { e: ScianEntry; t: string; p: string }[] } };

export function catalog() {
  if (g.__scian) return g.__scian;
  const raw = JSON.parse(fs.readFileSync(path.resolve("config/scian-2023.json"), "utf8")) as Catalog;
  const byCode = new Map(raw.entries.map((e) => [e.c, e]));
  const idx = raw.entries.map((e) => ({ e, t: fold(e.t), p: fold(raw.products[e.c] ?? "") }));
  return (g.__scian = { ...raw, byCode, idx });
}

/** minuscules, sans accents ni ponctuation. */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();

/** Mots français (et quelques mots courants) → mots espagnols du catalogue officiel. */
const FR: Record<string, string[]> = {
  coiffure: ["peluqueria", "corte de cabello", "salon de belleza"], coiffeur: ["peluqueria", "corte de cabello"], coiffeuse: ["peluqueria"],
  cheveux: ["cabello"], ongles: ["unas"], ongle: ["unas"], manucure: ["manicure", "unas"], pedicure: ["pedicure"],
  cils: ["pestanas"], sourcils: ["cejas"], barbier: ["barberia", "afeitado"], barbe: ["afeitado"], beaute: ["belleza"],
  esthetique: ["estetica", "belleza"], estheticienne: ["estetica", "belleza"], institut: ["salon de belleza"],
  maquillage: ["maquillaje"], epilation: ["depilacion"], massage: ["masaje"], massages: ["masaje"], tatouage: ["tatuaje"],
  dentiste: ["dental", "dentista"], dentaire: ["dental"], medecin: ["consultorios de medicina"], kine: ["fisioterapia"],
  kinesitherapeute: ["fisioterapia"], psychologue: ["psicologia"], opticien: ["optica", "anteojos"], veterinaire: ["veterinari"],
  pharmacie: ["farmacia"], restaurant: ["restaurante"], restaurants: ["restaurante"], resto: ["restaurante"], cafe: ["cafeteria"],
  boulangerie: ["panaderia"], patisserie: ["pasteleria", "reposteria"], glacier: ["helado", "neveria"], bar: ["bares", "cantina"],
  traiteur: ["banquetes", "comida para llevar"], pizzeria: ["pizza"], tacos: ["tacos"], hotel: ["hotel"], hotels: ["hotel"],
  hebergement: ["alojamiento", "hotel"], salle: ["gimnasio"], sport: ["acondicionamiento fisico", "gimnasio"], gym: ["gimnasio"],
  yoga: ["yoga"], plongee: ["buceo"], garage: ["reparacion mecanica", "automoviles"], mecanique: ["reparacion mecanica"],
  lavage: ["lavado"], pressing: ["tintoreria", "lavanderia"], laverie: ["lavanderia"], fleuriste: ["flores"], fleurs: ["flores"],
  boutique: ["comercio al por menor"], vetements: ["ropa"], chaussures: ["calzado"], bijouterie: ["joyeria"], immobilier: ["inmobiliari"],
  agence: ["agencia"], voyage: ["viajes"], voyages: ["viajes"], ecole: ["escuela"], cours: ["ensenanza"], photographe: ["fotografia"],
  avocat: ["abogado", "bufete juridico"], comptable: ["contabilidad"], nettoyage: ["limpieza"], plombier: ["plomeria"],
  electricien: ["electricas"], serrurier: ["cerrajeria"], animaux: ["mascotas"], toilettage: ["mascotas"], epicerie: ["abarrotes"],
  supermarche: ["supermercado"], location: ["alquiler"], voiture: ["automoviles"], velo: ["bicicleta"], spa: ["spa", "masaje"],
  // Espagnol courant absent de l'index officiel
  barberia: ["peluqueria", "afeitado"], barbero: ["peluqueria", "afeitado"], dentista: ["dental"], odontologo: ["dental"],
  estetica: ["belleza", "estetica"], gimnasio: ["acondicionamiento fisico", "gimnasio"], unas: ["unas"],
  lashes: ["pestanas"], nails: ["unas"], cafeteria: ["cafeteria"], veterinaria: ["veterinari"],
};

/** Commerces locaux (commerce de détail, services) avant la fabrication / le commerce de gros / le secteur public. */
function sectorBoost(code: string): number {
  const s = code.slice(0, 2);
  if (["54", "56", "61", "62", "71", "72", "81"].includes(s)) return 6;   // services
  if (s === "46") return 3;                                                   // commerce de détail
  if (["31", "32", "33", "43", "11", "21", "22"].includes(s)) return -6;
  return 0;
}

export type ScianHit = { code: string; title: string; level: number; match: string; parent: string };

/**
 * Recherche : chaque mot (FR traduit ou ES) doit apparaître dans le titre ou l'index des biens et services.
 * Classement : titre > index, classes (6 chiffres) d'abord ; extrait de l'index trouvé pour expliquer le résultat.
 */
export function searchScian(q: string, limit = 30): ScianHit[] {
  const c = catalog();
  const words = fold(q).split(" ").filter((w) => w.length >= 2).slice(0, 6);
  if (!words.length) return [];
  if (words.length === 1 && /^\d{2,6}$/.test(words[0])) {
    return c.entries.filter((e) => e.c.startsWith(words[0])).slice(0, limit).map((e) => hit(e, ""));
  }
  // Chaque mot devient un groupe d'alternatives (le mot lui-même + ses traductions espagnoles).
  const groups = words.map((w) => [w, ...(FR[w] ?? []).map(fold)]);
  const scored: { e: ScianEntry; s: number; m: string }[] = [];
  for (const it of c.idx) {
    let s = 0, m = "";
    let ok = true;
    for (const alts of groups) {
      const inT = alts.find((a) => has(it.t, a));
      if (inT) { s += 10; continue; }
      const inP = alts.find((a) => has(it.p, a));
      if (inP) { s += 3; if (!m) m = snippet(c.products[it.e.c] ?? "", inP); continue; }
      ok = false; break;
    }
    if (!ok) continue;
    s += (it.e.l === 6 ? 2 : it.e.l === 4 ? 1 : 0) + sectorBoost(it.e.c) + (/sector publico/.test(it.t) ? -4 : 0);
    scored.push({ e: it.e, s, m });
  }
  return scored.sort((a, b) => b.s - a.s || a.e.c.localeCompare(b.e.c)).slice(0, limit).map((x) => hit(x.e, x.m));
}

/** Mot ou expression présent au début d'un mot (« una » trouve « unas », pas « lunas »). */
const has = (text: string, w: string) => (" " + text).includes(" " + w);

function snippet(products: string, w: string) {
  const parts = products.split(" | ");
  return parts.find((p) => has(fold(p), w)) ?? "";
}

function hit(e: ScianEntry, match: string): ScianHit {
  const c = catalog();
  const parent = e.l > 2 ? c.byCode.get(e.c.slice(0, e.l - 1))?.t ?? "" : "";
  return { code: e.c, title: e.t, level: e.l, match, parent };
}

export const scianTitle = (code: string) => catalog().byCode.get(code)?.t ?? "";

/** Code de classe (6 chiffres) d'après l'intitulé d'activité renvoyé par DENUE (méthodes sans CLASE_ACTIVIDAD_ID). */
export function classOfTitle(title: string): string {
  const t = fold(title);
  if (!t) return "";
  const c = catalog();
  const e = c.idx.find((x) => x.e.l === 6 && x.t === t);
  return e?.e.c ?? "";
}

/** Supprime les codes déjà couverts par un code plus court de la liste (évite de compter deux fois). */
export function dedupeCodes(codes: string[]): string[] {
  const u = [...new Set(codes.map((x) => x.replace(/\D/g, "")).filter((x) => x.length >= 2 && x.length <= 6))].sort((a, b) => a.length - b.length);
  return u.filter((x, i) => !u.slice(0, i).some((p) => p !== x && x.startsWith(p)));
}
