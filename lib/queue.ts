// File du jour : 3 blocs (réponses à traiter, relances dues, nouveaux à contacter), figée pour la journée.
// - Les positions sont enregistrées (table daily_queue) : la liste ne se réorganise pas toute seule.
// - Un prospect traité (résultat enregistré) ou qui n'est plus éligible disparaît.
// - Les nouveaux éligibles (réponse arrivée, relance due) sont AJOUTÉS EN FIN de bloc, jamais intercalés.
// - Un changement du filtre / de l'ordre (Réglages > Objectifs) reconstruit seulement les nouveaux non traités.
import { createHash } from "node:crypto";
import { db, today } from "./db";
import { dayCounts, type Business, type Filters } from "./crm";
import { objectives, type Objectives } from "./settings";
import { stageOf, type Block, type Stage } from "./stage";
import { newWhere, dayFilter, filterWhere } from "./queue-count";

const SNAPSHOT_MAX = 300; // réponses / relances prises en une fois (au-delà : complétées au fil de la journée)

const ORDER_NEW: Record<Objectives["order"], string> = {
  offre_avis: "offre = '', offre COLLATE NOCASE, nb_avis IS NULL, nb_avis DESC, id",
  avis: "nb_avis IS NULL, nb_avis DESC, id",
  recent: "id DESC",
};

// « Ne pas contacter » : jamais dans la file (aucun bloc).
const SQL_REPONSES = `ne_pas_contacter = 0 AND ((statut = 'a_repondu' AND (next_date IS NULL OR next_date <= @day))
  OR (statut = 'interesse' AND next_date IS NOT NULL AND next_date <= @day))`;
const SQL_RELANCES = "ne_pas_contacter = 0 AND statut = 'contacte' AND next_followup IS NOT NULL AND next_followup <= @day";

/** Bloc dans lequel la fiche devrait être aujourd'hui (null : hors file). */
export function blockOf(b: Business, day = today()): Block | null {
  if (b.ne_pas_contacter) return null;
  if (b.statut === "a_repondu" && (!b.next_date || b.next_date <= day)) return "reponses";
  if (b.statut === "interesse" && b.next_date && b.next_date <= day) return "reponses";
  if (b.statut === "contacte" && b.next_followup && b.next_followup <= day) return "relances";
  if (b.statut === "a_contacter" && !b.no_whatsapp && b.tel_norm) return "nouveaux";
  return null;
}

const hashOf = (o: Objectives) => createHash("sha1").update(JSON.stringify({ f: o.filter, o: o.order })).digest("hex").slice(0, 16);

/** Objectifs du jour : ceux de Réglages, avec le filtre « Ma journée » s'il y en a un pour ce jour. */
export function dayObjectives(day = today()): Objectives & { dayFilter: boolean; filterRelances: boolean } {
  const o = objectives();
  const df = dayFilter(day);
  return df ? { ...o, filter: df.filter, dayFilter: true, filterRelances: df.relances } : { ...o, dayFilter: false, filterRelances: false };
}

/** Crée / complète la file du jour. Idempotent, appelé à chaque affichage. */
export function ensureQueue(day = today(), o: Objectives = dayObjectives(day)) {
  const hash = hashOf(o);
  db.transaction(() => {
    const meta = db.prepare("SELECT hash FROM queue_meta WHERE day=?").get(day) as { hash: string } | undefined;
    if (meta && meta.hash !== hash) db.prepare("DELETE FROM daily_queue WHERE day=? AND block='nouveaux' AND done_at IS NULL AND picked = 0").run(day);
    if (!meta || meta.hash !== hash) db.prepare("INSERT INTO queue_meta(day, hash) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET hash=excluded.hash").run(day, hash);
    // Purge des anciennes files (30 jours)
    db.prepare("DELETE FROM daily_queue WHERE day < date(?, '-30 days')").run(day);

    const append = (block: Block, ids: number[]) => {
      if (!ids.length) return;
      let pos = (db.prepare("SELECT COALESCE(MAX(position),0) p FROM daily_queue WHERE day=? AND block=?").get(day, block) as { p: number }).p;
      const ins = db.prepare("INSERT OR IGNORE INTO daily_queue(day, block, business_id, position) VALUES(?,?,?,?)");
      for (const id of ids) ins.run(day, block, id, ++pos);
    };
    const notQueued = (block: Block) => `id NOT IN (SELECT business_id FROM daily_queue WHERE day=@day AND block='${block}')`;

    append("reponses", (db.prepare(`SELECT id FROM businesses WHERE (${SQL_REPONSES}) AND ${notQueued("reponses")}
      ORDER BY COALESCE(next_date, substr(statut_date,1,10)), statut_date, id LIMIT ${SNAPSHOT_MAX}`).all({ day }) as { id: number }[]).map((r) => r.id));
    append("relances", (db.prepare(`SELECT id FROM businesses WHERE ${SQL_RELANCES} AND ${notQueued("relances")}
      ORDER BY next_followup, first_contact_at, id LIMIT ${SNAPSHOT_MAX}`).all({ day }) as { id: number }[]).map((r) => r.id));

    // Nouveaux : de quoi aller jusqu'à la limite dure (objectif affiché, le reste en « en faire plus »).
    const pending = (db.prepare(`SELECT COUNT(*) n FROM daily_queue q JOIN businesses b ON b.id=q.business_id
      WHERE q.day=? AND q.block='nouveaux' AND q.done_at IS NULL AND b.statut='a_contacter' AND b.no_whatsapp=0 AND b.ne_pas_contacter=0`).get(day) as { n: number }).n;
    const need = Math.max(0, o.newHard - dayCounts(day).newWa) - pending;
    if (need > 0) {
      const w = newWhere(o);
      const named = Object.fromEntries(w.args.map((v, i) => [`a${i}`, v]));
      let k = 0;
      const sql = w.sql.replace(/\?/g, () => `@a${k++}`);
      append("nouveaux", (db.prepare(`SELECT id FROM businesses WHERE ${sql} AND ${notQueued("nouveaux")} ORDER BY ${ORDER_NEW[o.order]} LIMIT ${need}`)
        .all({ ...named, day }) as { id: number }[]).map((r) => r.id));
    }
  })();
}

export type QueueItem = { qid: number; block: Block; stage: Stage; b: Business };
export type BlockView = { items: QueueItem[]; extra: QueueItem[]; goal: number | null; done: number; total: number };

/** File du jour prête à afficher : éléments visibles (jusqu'à l'objectif) et « en faire plus » (jusqu'à la limite). */
export function todayQueue(day = today()) {
  const o = dayObjectives(day);
  ensureQueue(day, o);
  const rows = db.prepare(`SELECT q.id qid, q.block, b.* FROM daily_queue q JOIN businesses b ON b.id=q.business_id
    WHERE q.day=? AND q.done_at IS NULL ORDER BY q.position, q.id`).all(day) as (Business & { qid: number; block: Block })[];
  const c = dayCounts(day);
  const by: Record<Block, QueueItem[]> = { reponses: [], relances: [], nouveaux: [] };
  // « Filtrer aussi les relances » (Ma journée) : réponses et relances limitées au même filtre
  let keep: Set<number> | null = null;
  if (o.filterRelances) {
    const f = filterWhere(o.filter);
    const ids = rows.filter((r) => r.block !== "nouveaux").map((r) => r.id);
    keep = new Set(ids.length && f.sql.length ? (db.prepare(`SELECT id FROM businesses WHERE id IN (${ids.map(() => "?").join(",")}) AND ${f.sql.join(" AND ")}`)
      .all(...ids, ...f.args) as { id: number }[]).map((x) => x.id) : ids);
  }
  for (const r of rows) {
    const { qid, block, ...b } = r;
    if (keep && block !== "nouveaux" && !keep.has(b.id)) continue;
    if (blockOf(b as Business, day) !== block) continue; // traité ailleurs / plus éligible
    by[block].push({ qid, block, stage: stageOf(b), b: b as Business });
  }
  const cap = (items: QueueItem[], goalLeft: number, hardLeft: number) =>
    ({ items: items.slice(0, Math.max(0, goalLeft)), extra: items.slice(Math.max(0, goalLeft), Math.max(0, hardLeft)) });
  const nouveaux = cap(by.nouveaux, o.newGoal - c.newWa, o.newHard - c.newWa);
  const relances = cap(by.relances, o.relances - c.relances, Number.MAX_SAFE_INTEGER);
  const blocks: Record<Block, BlockView> = {
    reponses: { items: by.reponses, extra: [], goal: null, done: c.replies, total: by.reponses.length },
    relances: { ...relances, goal: o.relances, done: c.relances, total: by.relances.length },
    nouveaux: { ...nouveaux, goal: o.newGoal, done: c.newWa, total: by.nouveaux.length },
  };
  return { day, o, counts: c, blocks, hardLeft: Math.max(0, o.newHard - c.newWa) };
}

/** « Passer » : remet l'élément en fin de son bloc, sans rien journaliser. */
export function skipItem(qid: number, day = today()) {
  const q = db.prepare("SELECT block FROM daily_queue WHERE id=? AND day=?").get(qid, day) as { block: string } | undefined;
  if (!q) return false;
  db.prepare("UPDATE daily_queue SET position = (SELECT COALESCE(MAX(position),0)+1 FROM daily_queue WHERE day=? AND block=?) WHERE id=?").run(day, q.block, qid);
  return true;
}

/** Identifiants de la file du jour (à traiter, y compris « en faire plus »). */
/**
 * « Ajouter à ma journée » (Commerces, Carte) : fiches « À contacter » joignables placées en tête des nouveaux, gardées
 * même si le filtre change. Les autres (déjà en relance / réponse, perdues, sans WhatsApp…) sont ignorées.
 */
export function pickForToday(ids: number[], day = today()): { added: number; already: number; skipped: number } {
  let added = 0, already = 0, skipped = 0;
  db.transaction(() => {
    ensureQueue(day);
    let pos = (db.prepare("SELECT COALESCE(MIN(position), 0) p FROM daily_queue WHERE day=? AND block='nouveaux'").get(day) as { p: number }).p;
    const get = db.prepare("SELECT statut, no_whatsapp, tel_norm, ne_pas_contacter FROM businesses WHERE id = ?");
    const ex = db.prepare("SELECT id, done_at FROM daily_queue WHERE day=? AND block='nouveaux' AND business_id=?");
    const ins = db.prepare("INSERT INTO daily_queue(day, block, business_id, position, picked) VALUES(?,?,?,?,1)");
    const up = db.prepare("UPDATE daily_queue SET position = ?, picked = 1 WHERE id = ?");
    for (const id of [...ids].reverse()) {
      const b = get.get(id) as { statut: string; no_whatsapp: number; tel_norm: string; ne_pas_contacter: number } | undefined;
      if (!b || b.statut !== "a_contacter" || b.no_whatsapp || !b.tel_norm || b.ne_pas_contacter) { skipped++; continue; }
      const q = ex.get(day, id) as { id: number; done_at: string | null } | undefined;
      if (q?.done_at) { already++; continue; }
      if (q) { up.run(--pos, q.id); already++; } else { ins.run(day, "nouveaux", id, --pos); added++; }
    }
  })();
  return { added, already, skipped };
}

export function todayQueueIds(day = today()): number[] {
  const q = todayQueue(day);
  return Object.values(q.blocks).flatMap((b) => [...b.items, ...b.extra].map((i) => i.b.id));
}
/** Filtre « dans la file du jour » (file=1) : résolu en liste d'identifiants. */
export function withQueue(f: Filters): Filters {
  return f.file === "1" ? { ...f, idIn: todayQueueIds() } : f;
}
