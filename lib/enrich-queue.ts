// File d'enrichissement (table enrich_queue) : séparée du worker (lib/enrich.ts) pour éviter les imports circulaires.
import { db, now } from "./db";

type W = { kick?: () => void };
const g = globalThis as unknown as { __enrichKick?: W };
export const enrichHooks: W = g.__enrichKick ?? (g.__enrichKick = {});

/** Fiches éligibles : site web renseigné et pas d'email. `ids` absent : toutes les fiches éligibles. */
export function enqueueEnrich(ids?: number[], opts: { force?: boolean } = {}): number {
  if (ids && !ids.length) return 0;
  const t = now();
  const n = db.transaction(() => {
    const pending = (db.prepare("SELECT COUNT(*) n FROM enrich_queue WHERE done_at IS NULL").get() as { n: number }).n;
    if (!pending) db.prepare("DELETE FROM enrich_queue WHERE done_at IS NOT NULL").run();
    const cond = `site_web != '' AND ${opts.force ? "1" : "email = ''"}`;
    const up = `INSERT INTO enrich_queue(business_id, added_at) SELECT id, @t FROM businesses WHERE ${cond} AND %W%
      ON CONFLICT(business_id) DO UPDATE SET done_at=NULL, result='', attempts=0, next_try_at=0, added_at=excluded.added_at
      WHERE enrich_queue.done_at IS NOT NULL`;
    if (!ids) return db.prepare(up.replace("%W%", "COALESCE(enrich_status,'') = ''")).run({ t }).changes;
    let c = 0;
    const st = db.prepare(up.replace("%W%", "id = @id"));
    for (const id of ids) c += st.run({ t, id }).changes;
    return c;
  })();
  if (n) enrichHooks.kick?.();
  return n;
}

export type EnrichStatus = { total: number; done: number; pending: number; found: number; nothing: number; failed: number; eligible: number; enabled: boolean; running: boolean };
export function enrichStatus(running = false): EnrichStatus {
  const q = db.prepare(`SELECT COUNT(*) total, SUM(done_at IS NOT NULL) done, SUM(done_at IS NULL) pending,
    SUM(result = 'trouve') found, SUM(result = 'rien') AS rien, SUM(result IN ('injoignable','bloque','robots','erreur')) failed FROM enrich_queue`).get() as Record<string, number | null>;
  const eligible = (db.prepare("SELECT COUNT(*) n FROM businesses WHERE site_web != '' AND email = '' AND COALESCE(enrich_status,'') = ''").get() as { n: number }).n;
  return { total: q.total ?? 0, done: q.done ?? 0, pending: q.pending ?? 0, found: q.found ?? 0, nothing: q.rien ?? 0, failed: q.failed ?? 0,
    eligible, enabled: process.env.ENRICHER !== "off", running };
}
