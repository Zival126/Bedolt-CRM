// Localidades de Quintana Roo (catalogue officiel INEGI, config/localidades-qroo.json) : noms propres des villes,
// municipio d'une ville (tableau « Marché »), localidades proposées dans la recherche DENUE.
import fs from "node:fs";
import path from "node:path";
import { fold } from "./scian";
import { loadMunicipios } from "./municipios";

export type Localidad = { m: string; c: string; n: string; p: number; lat: number | null; lng: number | null };
const g = globalThis as unknown as { __locs?: { list: Localidad[]; byCode: Map<string, Localidad>; byName: Map<string, Localidad> } };

function data() {
  if (g.__locs) return g.__locs;
  const raw = JSON.parse(fs.readFileSync(path.resolve("config/localidades-qroo.json"), "utf8")) as { localidades: Localidad[] };
  const byCode = new Map(raw.localidades.map((l) => [l.m + l.c, l]));
  const byName = new Map<string, Localidad>();
  // Le nom le plus peuplé l'emporte (localidades homonymes dans deux municipios)
  for (const l of [...raw.localidades].sort((a, b) => b.p - a.p)) if (!byName.has(fold(l.n))) byName.set(fold(l.n), l);
  return (g.__locs = { list: raw.localidades, byCode, byName });
}

export const localidades = (municipio?: string) => data().list.filter((l) => !municipio || l.m === municipio);
/** « 005 » + « 0001 » → Cancún. */
export const localidad = (mun: string, loc: string) => data().byCode.get(mun + loc);

/** Municipios avec leur chef-lieu (localidad 0001) : « Benito Juárez · Cancún ». */
export function municipiosWithSeat() {
  const m = loadMunicipios();
  return { entidad: m.entidad, municipios: m.municipios.map((x) => ({ ...x, seat: localidad(x.code, "0001")?.n ?? "" })) };
}

/** Municipio (3 chiffres) d'une fiche : CLEE DENUE (2 chiffres d'entité + 3 de municipio), sinon nom de la ville. */
export function municipioOf(b: { denue_id?: string; ville?: string; zone?: string }): string {
  const clee = (b.denue_id ?? "").trim();
  if (/^23\d{3}/.test(clee)) return clee.slice(2, 5);
  const muns = loadMunicipios().municipios;
  for (const v of [b.ville, b.zone]) {
    const f = fold(v ?? "");
    if (!f) continue;
    const l = data().byName.get(f);
    if (l) return l.m;
    const m = muns.find((x) => fold(x.nom) === f);
    if (m) return m.code;
  }
  return "";
}
