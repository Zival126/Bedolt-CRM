// Niches du CRM (page Niches) : nom, couleur, icône, description, archivée, et correspondances
// (codes SCIAN pour DENUE, tags OSM, catégories Overture, mots-clés de la colonne « Niche » des fichiers Excel).
// Chaque fiche pointe vers une niche (businesses.niche_id) ; la colonne texte businesses.niche garde son libellé.
import { z } from "zod";
import { db, now } from "./db";
import { fold, dedupeCodes } from "./scian";
import { DEFAULT_NICHES, seedCodes, globMatch } from "./niche-seed";
import { nextColor, isHexColor, isIcon, NO_NICHE, type NicheLite } from "./niche-style";

export type MapKind = "scian" | "osm" | "overture" | "keyword";
export const MAP_KINDS: MapKind[] = ["scian", "osm", "overture", "keyword"];
export type NicheRow = NicheLite & {
  description: string; archived: boolean; position: number;
  scian: string[]; osm: string[]; overture: string[]; keywords: string[];
};
export { globMatch };

/** Toutes les niches (actives d'abord, dans l'ordre), avec leurs correspondances. 2 requêtes. */
export function allNiches(opts: { archived?: boolean } = {}): NicheRow[] {
  const rows = db.prepare(`SELECT id, label, color, icon, description, archived, position FROM niches ${opts.archived ? "" : "WHERE archived = 0"}
    ORDER BY archived, position, label COLLATE NOCASE`).all() as (Omit<NicheRow, "archived" | MapKind | "keywords"> & { archived: number })[];
  const maps = db.prepare("SELECT niche_id, kind, value FROM niche_maps ORDER BY kind, value").all() as { niche_id: number; kind: MapKind; value: string }[];
  const by = new Map<number, NicheRow>();
  const out = rows.map((r) => { const n: NicheRow = { ...r, archived: !!r.archived, scian: [], osm: [], overture: [], keywords: [] }; by.set(r.id, n); return n; });
  for (const m of maps) { const n = by.get(m.niche_id); if (!n) continue; (m.kind === "keyword" ? n.keywords : n[m.kind]).push(m.value); }
  return out;
}
/** N° d'opération sur les niches : un regroupement n'est annulable que si aucune autre opération n'a eu lieu depuis. */
export const nicheOpsSeq = () => Number((db.prepare("SELECT value FROM settings WHERE key = 'niche_ops'").get() as { value: string } | undefined)?.value ?? 0) || 0;
export function bumpNicheOps(): number {
  const n = nicheOpsSeq() + 1;
  db.prepare("INSERT INTO settings(key, value) VALUES('niche_ops', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(n));
  return n;
}

export const nicheLite = (n: NicheRow): NicheLite => ({ id: n.id, label: n.label, color: n.color, icon: n.icon });
/** Niches pour l'interface (puces, badges, carte) : actives + archivées encore utilisées par des fiches. */
export function nicheList(includeArchived = true): NicheLite[] {
  return (db.prepare(`SELECT id, label, color, icon FROM niches ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY archived, position, label COLLATE NOCASE`).all() as NicheLite[]);
}
export const nicheById = (id: number) => allNiches({ archived: true }).find((n) => n.id === id);

// ---------- Édition ----------
export const NicheInput = z.object({
  label: z.string().trim().min(1, "nom obligatoire").max(60),
  color: z.string().refine(isHexColor, "couleur #rrggbb").optional(),
  icon: z.string().refine(isIcon, "icône inconnue").optional(),
  description: z.string().trim().max(200).optional(),
});
export class NicheError extends Error {}

const labelTaken = (label: string, except = 0) =>
  (db.prepare("SELECT id FROM niches WHERE label = ? COLLATE NOCASE AND id != ?").get(label, except) as { id: number } | undefined)
  ?? allNiches({ archived: true }).find((n) => n.id !== except && fold(n.label) === fold(label));

export function createNiche(i: z.infer<typeof NicheInput>): number {
  if (labelTaken(i.label)) throw new NicheError(`La niche « ${i.label} » existe déjà.`);
  const used = (db.prepare("SELECT color FROM niches WHERE archived = 0").all() as { color: string }[]).map((r) => r.color);
  const pos = (db.prepare("SELECT COALESCE(MAX(position), 0) + 1 p FROM niches").get() as { p: number }).p;
  bumpNicheOps();
  return Number(db.prepare("INSERT INTO niches(label, color, icon, description, position, created_at) VALUES(?,?,?,?,?,?)")
    .run(i.label, i.color ?? nextColor(used), i.icon ?? "tag", i.description ?? "", pos, now()).lastInsertRowid);
}

/** Renomme / recolore ; le libellé des fiches suit. */
export function updateNiche(id: number, i: Partial<z.infer<typeof NicheInput>> & { archived?: boolean }) {
  const cur = db.prepare("SELECT label FROM niches WHERE id = ?").get(id) as { label: string } | undefined;
  if (!cur) throw new NicheError("Niche introuvable.");
  if (i.label && labelTaken(i.label, id)) throw new NicheError(`La niche « ${i.label} » existe déjà.`);
  bumpNicheOps();
  db.transaction(() => {
    const sets: string[] = [], vals: unknown[] = [];
    for (const k of ["label", "color", "icon", "description"] as const) if (i[k] !== undefined) { sets.push(`${k} = ?`); vals.push(i[k]); }
    if (i.archived !== undefined) { sets.push("archived = ?"); vals.push(i.archived ? 1 : 0); }
    if (sets.length) db.prepare(`UPDATE niches SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    if (i.label && i.label !== cur.label) {
      db.prepare("UPDATE businesses SET niche = ? WHERE niche_id = ?").run(i.label, id);
      db.prepare("INSERT OR IGNORE INTO niche_maps(niche_id, kind, value) VALUES(?, 'keyword', ?)").run(id, fold(cur.label));
    }
  })();
}

/** Remplace les correspondances d'un type (valeurs nettoyées, sans doublon). */
export function setNicheMaps(id: number, kind: MapKind, values: string[]) {
  const clean = [...new Set(values.map((v) => (kind === "keyword" ? fold(v) : v.trim().toLowerCase())).filter(Boolean))];
  const ok = clean.filter((v) => kind === "scian" ? /^\d{2,6}$/.test(v) : kind === "osm" ? /^!?[a-z_]+=[a-z0-9_;:-]+$/.test(v)
    : kind === "overture" ? /^!?[a-z0-9_*]{2,80}$/.test(v) : v.length >= 2 && v.length <= 60);
  bumpNicheOps();
  db.transaction(() => {
    db.prepare("DELETE FROM niche_maps WHERE niche_id = ? AND kind = ?").run(id, kind);
    const ins = db.prepare("INSERT OR IGNORE INTO niche_maps(niche_id, kind, value) VALUES(?,?,?)");
    for (const v of kind === "scian" ? dedupeCodes(ok) : ok) ins.run(id, kind, v);
  })();
}

/** Fusionne `src` dans `dst` : fiches, correspondances et filtre de la file déplacés ; `src` supprimée. */
export function mergeNiches(src: number, dst: number): number {
  if (src === dst) throw new NicheError("Choisis deux niches différentes.");
  const d = db.prepare("SELECT label FROM niches WHERE id = ?").get(dst) as { label: string } | undefined;
  const s = db.prepare("SELECT label FROM niches WHERE id = ?").get(src) as { label: string } | undefined;
  if (!d || !s) throw new NicheError("Niche introuvable.");
  bumpNicheOps();
  return db.transaction(() => {
    const moved = db.prepare("UPDATE businesses SET niche_id = ?, niche = ? WHERE niche_id = ?").run(dst, d.label, src).changes;
    db.prepare("INSERT OR IGNORE INTO niche_maps(niche_id, kind, value) SELECT ?, kind, value FROM niche_maps WHERE niche_id = ?").run(dst, src);
    db.prepare("INSERT OR IGNORE INTO niche_maps(niche_id, kind, value) VALUES(?, 'keyword', ?)").run(dst, fold(s.label));
    db.prepare("DELETE FROM niches WHERE id = ?").run(src);
    remapIds((ids) => [...new Set(ids.map((x) => (x === src ? dst : x)))]);
    return moved;
  })();
}

/** Applique une transformation aux identifiants de niche enregistrés (filtre de la file, filtres du jour). */
export function remapIds(fn: (ids: number[]) => number[]) {
  const upd = (key: string, raw: string, save: (v: string) => void) => {
    try { const o = JSON.parse(raw); const f = key === "objectives" ? o.filter : o; if (f && Array.isArray(f.nicheIds)) { f.nicheIds = fn(f.nicheIds); save(JSON.stringify(o)); } } catch { /* illisible */ }
  };
  const o = db.prepare("SELECT value FROM settings WHERE key = 'objectives'").get() as { value: string } | undefined;
  if (o) upd("objectives", o.value, (v) => db.prepare("UPDATE settings SET value = ? WHERE key = 'objectives'").run(v));
  for (const r of db.prepare("SELECT day, filter FROM day_filters").all() as { day: string; filter: string }[])
    upd("day", r.filter, (v) => db.prepare("UPDATE day_filters SET filter = ? WHERE day = ?").run(v, r.day));
}

/** Attribue une niche (ou aucune : null) à des fiches. */
export function assignNiche(ids: number[], nicheId: number | null): number {
  const label = nicheId ? (db.prepare("SELECT label FROM niches WHERE id = ?").get(nicheId) as { label: string } | undefined)?.label : "";
  if (nicheId && label === undefined) throw new NicheError("Niche introuvable.");
  const st = db.prepare("UPDATE businesses SET niche_id = ?, niche = ? WHERE id = ?");
  bumpNicheOps();
  let n = 0;
  db.transaction(() => { for (const id of ids) n += st.run(nicheId, label ?? "", id).changes; })();
  return n;
}

// ---------- Statistiques (page Niches) ----------
export type NicheStat = { id: number; fiches: number; contactees: number; reponses: number; clients: number; aContacter: number };
export function nicheStats(): Map<number, NicheStat> {
  const rows = db.prepare(`SELECT COALESCE(niche_id, 0) id, COUNT(*) fiches,
      SUM(CASE WHEN statut != 'a_contacter' OR first_contact_at IS NOT NULL THEN 1 ELSE 0 END) contactees,
      SUM(CASE WHEN statut IN ('a_repondu','interesse','paye') THEN 1 ELSE 0 END) reponses,
      SUM(CASE WHEN statut = 'paye' THEN 1 ELSE 0 END) clients,
      SUM(CASE WHEN statut = 'a_contacter' AND ne_pas_contacter = 0 THEN 1 ELSE 0 END) aContacter
    FROM businesses GROUP BY COALESCE(niche_id, 0)`).all() as NicheStat[];
  return new Map(rows.map((r) => [r.id, r]));
}

// ---------- Reconnaissance ----------
/** Niche correspondant à un texte libre (colonne « Niche » d'un fichier) : nom, puis mot-clé le plus long contenu. */
export function matchNicheText(text: string, list: NicheRow[] = allNiches({ archived: true })): NicheRow | null {
  const t = fold(text);
  if (!t) return null;
  const exact = list.find((n) => fold(n.label) === t) ?? list.find((n) => n.keywords.includes(t));
  if (exact) return exact;
  let best: NicheRow | null = null, len = 0;
  const padded = " " + t + " ";
  for (const n of list.filter((x) => !x.archived)) for (const k of n.keywords) {
    if (k.length >= 3 && k.length > len && (padded.includes(" " + k + " ") || (k.length >= 5 && t.includes(k)))) { best = n; len = k.length; }
  }
  return best;
}

/** Niche d'une classe SCIAN : la plus précise des niches actives dont un code couvre la classe. */
export function nicheForClasse(classe: string, list: NicheRow[] = allNiches()): NicheRow | null {
  if (!classe) return null;
  let best: NicheRow | null = null, len = 0;
  for (const n of list) for (const c of n.scian) if (classe.startsWith(c) && c.length > len) { best = n; len = c.length; }
  return best;
}

// ---------- Compatibilité (« Mes niches » = libellé + codes SCIAN) ----------
export const NicheSchema = z.object({
  label: z.string().trim().min(1).max(100),
  codes: z.array(z.string().regex(/^\d{2,6}$/, "code SCIAN : 2 à 6 chiffres")).min(1).max(60),
});
export const NichesSchema = z.array(NicheSchema).max(40);
export type Niche = z.infer<typeof NicheSchema>;

export const defaultNiches = (): Niche[] => DEFAULT_NICHES.map((n) => ({ label: n.label, codes: seedCodes(n) })).filter((n) => n.codes.length);
/** Niches actives qui ont des codes SCIAN (DENUE : raccourcis, Marché, ajout). */
export function niches(): (Niche & { id: number; color: string; icon: string })[] {
  return allNiches().filter((n) => n.scian.length).map((n) => ({ id: n.id, label: n.label, codes: n.scian, color: n.color, icon: n.icon }));
}
/** Enregistre une liste libellé → codes : niches créées / mises à jour, les autres archivées. */
export function saveNiches(list: Niche[]) {
  db.transaction(() => {
    const keep = new Set<number>();
    for (const n of list) {
      const ex = labelTaken(n.label);
      const id = ex ? ex.id : createNiche({ label: n.label });
      if (ex) db.prepare("UPDATE niches SET archived = 0 WHERE id = ?").run(id);
      setNicheMaps(id, "scian", n.codes);
      keep.add(id);
    }
    for (const n of allNiches()) if (!keep.has(n.id)) db.prepare("UPDATE niches SET archived = 1 WHERE id = ?").run(n.id);
  })();
}
/** Libellé de la niche d'une classe SCIAN ('' si aucune). */
export function nicheFor(classe: string, list?: { label: string; codes: string[] }[]): string {
  if (list) {
    let best = "", len = 0;
    for (const n of list) for (const c of n.codes) if (classe.startsWith(c) && c.length > len) { best = n.label; len = c.length; }
    return best;
  }
  return nicheForClasse(classe)?.label ?? "";
}
export { NO_NICHE };
