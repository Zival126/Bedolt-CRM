// Recherche DENUE complète (pagination automatique, plusieurs activités), dédoublonnage avec le CRM, ajout groupé,
// mise à jour d'une fiche depuis DENUE. Utilisé par la recherche (flux de progression) et par la veille hebdomadaire.
import { z } from "zod";
import { db, now, today } from "./db";
import { telNorm } from "./phone";
import { getBusiness, type Business } from "./crm";
import { addCandidates, type Candidate } from "./sources";
import { dedupeCodes } from "./scian";
import { nicheFor, niches } from "./niches";
import { ENTIDAD, PAGE, MAX_PAGES, DenueError, buscarArea, buscar, nombre, buscarEntidad, cuantificar, ficha, type DenueRow } from "./denue";

const digits = (max: number) => z.string().trim().regex(new RegExp(`^\\d{0,${max}}$`), `${max} chiffres maximum`).default("");
const codes = z.array(z.string().regex(/^\d{2,6}$/, "code SCIAN : 2 à 6 chiffres")).max(30).default([]);
export const SearchParamsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("zone"), municipio: digits(3), localidad: digits(4), codes: codes.refine((c) => c.length > 0, "choisis au moins une activité"), estrato: digits(1), nombre: z.string().trim().max(100).default("") }),
  z.object({ mode: z.literal("point"), lat: z.number().min(14).max(33), lng: z.number().min(-119).max(-86), rayon: z.number().min(1).max(5000), condition: z.string().trim().max(100).default(""), codes }),
  z.object({ mode: z.literal("nom"), q: z.string().trim().min(2).max(100), method: z.enum(["nombre", "entidad"]).default("nombre"), codes }),
]);
export type SearchParams = z.infer<typeof SearchParamsSchema>;

export type Progress = { step: string; done: number; total: number; fetched: number };
export type RunResult = { rows: DenueRow[]; expected: number | null; requests: number; partial?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAGE_PAUSE = Number(process.env.DENUE_PAGE_PAUSE_MS ?? 400);

/** Codes appliqués après coup (modes point / nom) : classe déduite de l'intitulé. */
const keepCodes = (rows: DenueRow[], c: string[]) => (c.length ? rows.filter((r) => c.some((x) => r.classe.startsWith(x))) : rows);

/**
 * Récupère TOUS les résultats : Cuantificar d'abord (volume, estimation du nombre de pages), puis pages de PAGE
 * enregistrements jusqu'à une page incomplète. Une erreur après reprises automatiques arrête la recherche et renvoie ce
 * qui a été récupéré (`partial`) : relancer reprend instantanément grâce au cache (24 h) des pages déjà lues.
 */
export async function runSearch(p: SearchParams, onProgress: (x: Progress) => void = () => {}): Promise<RunResult> {
  const out = new Map<string, DenueRow>();
  const add = (rows: DenueRow[]) => { for (const r of rows) if (r.clee && !out.has(r.clee)) out.set(r.clee, r); };
  let requests = 0, expected: number | null = null;
  const finish = (partial?: string) => ({ rows: [...out.values()], expected, requests, partial });
  try {
    if (p.mode === "point") {
      onProgress({ step: "Recherche autour du point", done: 0, total: 1, fetched: 0 });
      add(keepCodes(await buscar(p.lat, p.lng, p.rayon, p.condition), p.codes)); requests++;
      onProgress({ step: "Terminé", done: 1, total: 1, fetched: out.size });
      return finish();
    }
    if (p.mode === "nom") {
      const fn = p.method === "entidad" ? buscarEntidad : nombre;
      for (let page = 0; page < MAX_PAGES; page++) {
        onProgress({ step: `Page ${page + 1}`, done: page, total: page + 1, fetched: out.size });
        const rows = await fn(p.q, page * PAGE + 1, (page + 1) * PAGE); requests++;
        add(keepCodes(rows, p.codes));
        if (rows.length < PAGE) break;
        await sleep(PAGE_PAUSE);
      }
      onProgress({ step: "Terminé", done: 1, total: 1, fetched: out.size });
      return finish();
    }
    // Zone + activité : une série de pages par code (BuscarAreaActEstr ne prend qu'un code par niveau).
    const list = dedupeCodes(p.codes);
    const area = ENTIDAD + (p.municipio ? p.municipio.padStart(3, "0") + (p.localidad ? p.localidad.padStart(4, "0") : "") : "");
    onProgress({ step: "Comptage (Cuantificar)", done: 0, total: 1, fetched: 0 });
    const counts = new Map<string, number>();
    try {
      for (const c of await cuantificar(list, [area], p.estrato || "0")) counts.set(c.ae, (counts.get(c.ae) ?? 0) + c.total);
      requests++;
      expected = [...counts.values()].reduce((a, b) => a + b, 0);
    } catch (e) {
      if (e instanceof DenueError && /token/i.test(e.message)) throw e;  // le comptage est indicatif : on continue sinon
    }
    const pagesOf = (c: string) => Math.max(1, Math.ceil((counts.get(c) ?? PAGE) / PAGE));
    let total = list.reduce((a, c) => a + pagesOf(c), 0), done = 0;
    for (const code of list) {
      if (counts.get(code) === 0) continue;
      for (let page = 0; page < MAX_PAGES; page++) {
        onProgress({ step: `Activité ${code} · page ${page + 1} / ${pagesOf(code)}`, done, total: Math.max(total, done + 1), fetched: out.size });
        const r = await buscarArea({ municipio: p.municipio, localidad: p.localidad, code, estrato: p.estrato, nombre: p.nombre }, page * PAGE + 1, (page + 1) * PAGE);
        requests++; done++;
        add(r.rows);
        if (r.raw < PAGE) break;
        if (page + 1 >= pagesOf(code)) total++;      // plus de résultats que prévu par le comptage
        await sleep(PAGE_PAUSE);
      }
    }
    onProgress({ step: "Terminé", done: total, total, fetched: out.size });
    return finish();
  } catch (e) {
    if (!out.size) throw e;
    return finish((e as Error).message);
  }
}

// ---------- Dédoublonnage avec le CRM ----------
// Index commun à toutes les sources (lib/sources.ts) : CLEE, puis téléphone normalisé, puis nom proche à moins de 100 m.
export { existingIndex, type Existing } from "./sources";

// ---------- Ajout groupé ----------
export const AddItemSchema = z.object({
  clee: z.string().trim().min(1).max(40), id: z.string().max(20).default(""), nom: z.string().trim().min(1).max(300),
  activite: z.string().max(300).default(""), classe: z.string().regex(/^\d{0,6}$/).default(""), estrato: z.string().max(60).default(""),
  telephone: z.string().max(50).default(""), email: z.string().max(200).default(""), site_web: z.string().max(500).default(""),
  adresse: z.string().max(500).default(""), colonia: z.string().max(200).default(""), ville: z.string().max(200).default(""),
  lat: z.number().min(-90).max(90).nullable().default(null), lng: z.number().min(-180).max(180).nullable().default(null),
  alta: z.string().regex(/^(\d{4}-\d{2})?$/).default(""),
  fiche_google: z.enum(["", "oui", "non", "vide", "verifier"]).default(""), interet: z.enum(["", "chaud", "tiede", "froid"]).default(""),
  note: z.string().max(2000).default(""),
});
export type AddItem = z.infer<typeof AddItemSchema>;

/** Établissement DENUE → candidat commun (niche via « Mes niches », zone = colonia). */
export function denueCandidate(r: AddItem, list = niches()): Candidate {
  return {
    source: "denue", sourceId: r.clee, nom: r.nom, categorie: r.activite, niche: nicheFor(r.classe, list),
    telephone: r.telephone, email: r.email, site_web: r.site_web, facebook: "", instagram: "",
    adresse: r.adresse, colonia: r.colonia, ville: r.ville, lat: r.lat, lng: r.lng,
    denue: { num: r.id, alta: r.alta, estrato: r.estrato, activite: r.activite },
  };
}

/**
 * Ajoute en une transaction (tout ou rien) : statut À contacter, niche via « Mes niches », zone = colonia, position
 * DENUE (geo_source = denue), email, site, source DENUE + date. Une fiche déjà présente (CLEE, téléphone, nom proche à
 * moins de 100 m, ou doublon dans la sélection) est FUSIONNÉE : champs vides complétés, source « denue » ajoutée.
 * La qualification rapide (fiche Google, intérêt, note) ne s'applique qu'aux nouvelles fiches.
 */
export function addRows(items: AddItem[], label = ""): { added: number; merged: number; skipped: number; ids: Record<string, number> } {
  const list = niches();
  const r = addCandidates(items.map((x) => denueCandidate(x, list)), label);
  // Qualification rapide (nouvelles fiches seulement : jamais d'écrasement)
  const st = db.prepare("UPDATE businesses SET fiche_google = CASE WHEN fiche_google = '' THEN ? ELSE fiche_google END, interet = CASE WHEN interet = '' THEN ? ELSE interet END, notes = CASE WHEN notes = '' THEN ? ELSE notes END WHERE id = ?");
  db.transaction(() => { for (const x of items) if (r.ids[x.clee] && (x.fiche_google || x.interet || x.note)) st.run(x.fiche_google, x.interet, x.note, r.ids[x.clee]); })();
  return { added: r.added, merged: r.merged, skipped: r.merged, ids: r.ids };
}

// ---------- Mise à jour d'une fiche depuis DENUE (méthode Ficha) ----------
/**
 * Complète la fiche avec la version DENUE actuelle : téléphone, email, site, adresse, colonia, activité, strate
 * (champs vides seulement, sauf ceux venant déjà de DENUE) ; position DENUE si la fiche n'a pas de position manuelle.
 */
export async function refreshFromDenue(id: number): Promise<{ changed: string[]; row: DenueRow }> {
  const b = getBusiness(id);
  if (!b) throw new DenueError("Commerce introuvable.");
  let row: DenueRow | null = null;
  if (b.denue_num) row = await ficha(b.denue_num);
  else if (b.denue_id) {
    // Anciennes fiches sans « Id » : recherche par nom (1re page) et correspondance exacte du CLEE
    const rows = await nombre(b.nom.slice(0, 60), 1, PAGE);
    row = rows.find((r) => r.clee === b.denue_id) ?? null;
  } else throw new DenueError("Cette fiche ne vient pas de DENUE (aucun CLEE).");
  if (!row) throw new DenueError("Établissement introuvable dans DENUE (fermé ou retiré ?).");
  const fromDenue = b.source === "DENUE";
  const sets: Record<string, unknown> = { denue_num: row.id || b.denue_num, denue_sync: now() };
  const changed: string[] = [];
  const fill = (k: keyof Business, v: string, label: string) => {
    const cur = String(b[k] ?? "").trim();
    if (v && v !== cur && (!cur || fromDenue)) { sets[k] = v; changed.push(label); }
  };
  fill("email", row.email, "email"); fill("site_web", row.site_web, "site"); fill("adresse", row.adresse, "adresse");
  fill("colonia", row.colonia, "colonia"); fill("activite", row.activite, "activité"); fill("denue_estrato", row.estrato, "strate");
  if (row.alta) fill("denue_alta", row.alta, "date d'alta");
  if (row.telephone && telNorm(row.telephone) && !b.tel_norm) { sets.telephone = row.telephone; sets.tel_norm = telNorm(row.telephone); changed.push("téléphone"); }
  if (row.lat != null && row.lng != null && b.geo_source !== "manuel" && (row.lat !== b.lat || row.lng !== b.lng)) {
    Object.assign(sets, { lat: row.lat, lng: row.lng, geo_precision: "commerce", geo_source: "denue", geo_date: now() });
    changed.push("position");
    db.prepare("DELETE FROM geo_queue WHERE business_id = ? AND done_at IS NULL").run(id);
  }
  const k = Object.keys(sets);
  db.prepare(`UPDATE businesses SET ${k.map((x) => `${x} = ?`).join(", ")} WHERE id = ?`).run(...k.map((x) => sets[x]), id);
  return { changed, row };
}
