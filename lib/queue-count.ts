import { db } from "./db";
import type { Objectives } from "./settings";

/** Critères des nouveaux à contacter : statut, WhatsApp possible, filtre de la file (Réglages > Objectifs). */
export function newWhere(o: Objectives): { sql: string; args: unknown[] } {
  const w = ["statut = 'a_contacter'", "no_whatsapp = 0", "tel_norm != ''"];
  const args: unknown[] = [];
  const inList = (col: string, vals: string[], nocase = true) => {
    if (!vals.length) return;
    w.push(`${col}${nocase ? " COLLATE NOCASE" : ""} IN (${vals.map(() => "?").join(",")})`); args.push(...vals);
  };
  inList("niche", o.filter.niches); inList("zone", o.filter.zones); inList("offre", o.filter.offres);
  inList("ville", o.filter.villes); inList("fiche_google", o.filter.fiches, false);
  if (o.filter.avisMin != null) { w.push("nb_avis >= ?"); args.push(o.filter.avisMin); }
  return { sql: w.join(" AND "), args };
}

/** Nombre de prospects « À contacter » (avec WhatsApp possible) qui correspondent au filtre de la file. */
export function matchingNew(o: Objectives): number {
  const w = newWhere(o);
  return (db.prepare(`SELECT COUNT(*) n FROM businesses WHERE ${w.sql}`).get(...w.args) as { n: number }).n;
}
