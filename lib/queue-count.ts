import { db, today } from "./db";
import { QueueFilterSchema, type Objectives, type QueueFilter } from "./settings";

/** Conditions d'un filtre de file sur les attributs de la fiche (niche, lieu, offre, source, contacts). */
export function filterWhere(f: QueueFilter): { sql: string[]; args: unknown[] } {
  const w: string[] = [], args: unknown[] = [];
  const inList = (col: string, vals: string[], nocase = true) => {
    if (!vals.length) return;
    w.push(`${col}${nocase ? " COLLATE NOCASE" : ""} IN (${vals.map(() => "?").join(",")})`); args.push(...vals);
  };
  if (f.nicheIds.length) {
    const ids = f.nicheIds.filter((x) => x > 0);
    const none = f.nicheIds.includes(0);
    const parts = [ids.length ? `niche_id IN (${ids.map(() => "?").join(",")})` : "", none ? "niche_id IS NULL" : ""].filter(Boolean);
    w.push(`(${parts.join(" OR ")})`); args.push(...ids);
  }
  inList("zone", f.zones); inList("offre", f.offres); inList("ville", f.villes); inList("fiche_google", f.fiches, false);
  if (f.avisMin != null) { w.push("nb_avis >= ?"); args.push(f.avisMin); }
  if (f.sources.length) { w.push(`(${f.sources.map(() => "(',' || sources || ',') LIKE ?").join(" OR ")})`); args.push(...f.sources.map((s) => `%,${s},%`)); }
  if (f.wa) w.push("wa_confirme = 1");
  if (f.email) w.push("email != ''");
  return { sql: w, args };
}

/** Critères des nouveaux à contacter : statut, WhatsApp possible, filtre de la file. */
export function newWhere(o: Objectives): { sql: string; args: unknown[] } {
  const f = filterWhere(o.filter);
  return { sql: ["statut = 'a_contacter'", "no_whatsapp = 0", "tel_norm != ''", "ne_pas_contacter = 0", ...f.sql].join(" AND "), args: f.args };
}

/** Nombre de prospects « À contacter » (avec WhatsApp possible) qui correspondent au filtre de la file. */
export function matchingNew(o: Objectives): number {
  const w = newWhere(o);
  return (db.prepare(`SELECT COUNT(*) n FROM businesses WHERE ${w.sql}`).get(...w.args) as { n: number }).n;
}

// ---------- « Ma journée » : filtre du jour (remplace le filtre par défaut de Réglages pour ce jour) ----------
export type DayFilter = { filter: QueueFilter; relances: boolean };
export function dayFilter(day = today()): DayFilter | null {
  const r = db.prepare("SELECT filter, relances FROM day_filters WHERE day = ?").get(day) as { filter: string; relances: number } | undefined;
  if (!r) return null;
  try { const p = QueueFilterSchema.safeParse(JSON.parse(r.filter)); if (p.success) return { filter: p.data, relances: !!r.relances }; } catch { /* illisible */ }
  return null;
}
export function setDayFilter(df: DayFilter | null, day = today()) {
  if (!df) { db.prepare("DELETE FROM day_filters WHERE day = ?").run(day); return; }
  db.prepare("INSERT INTO day_filters(day, filter, relances) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET filter = excluded.filter, relances = excluded.relances")
    .run(day, JSON.stringify(df.filter), df.relances ? 1 : 0);
  db.prepare("DELETE FROM day_filters WHERE day < date(?, '-30 days')").run(day);
}
