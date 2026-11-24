// Recherches DENUE enregistrées, veille hebdomadaire (tâche planifiée dans le serveur, comme le géocodage) et
// tableau « Marché » (Cuantificar). La veille ne fait qu'enregistrer les établissements jamais vus (CLEE) : aucun
// ajout automatique au CRM, tu valides depuis la page DENUE.
import { db, now } from "./db";
import { denueToken } from "./settings";
import { runSearch, SearchParamsSchema, existingIndex, type SearchParams, type SearchParamsIn } from "./denue-run";
import { cuantificar, ENTIDAD, type DenueRow } from "./denue";
import { niches } from "./niches";
import { dedupeCodes } from "./scian";
import { loadMunicipios } from "./municipios";
import { municipioOf } from "./geo-qroo";
import { entidades, municipiosOf, municipio, zoneLabel } from "./geo-mx";

export type SavedSearch = { id: number; name: string; params: SearchParams; watch: boolean; created_at: string; last_run_at: string | null; last_total: number | null; last_error: string; news: number };
type Row = Omit<SavedSearch, "params" | "watch" | "news"> & { params: string; watch: number };

const parseParams = (s: string): SearchParams | null => { try { const r = SearchParamsSchema.safeParse(JSON.parse(s)); return r.success ? r.data : null; } catch { return null; } };

export function savedSearches(): SavedSearch[] {
  const news = newCounts();
  return (db.prepare("SELECT * FROM denue_searches ORDER BY name COLLATE NOCASE, id").all() as Row[]).flatMap((r) => {
    const params = parseParams(r.params);
    if (params && !params.place && params.mode !== "point") params.place = params.mode === "zone" ? zoneLabel({ ent: params.entidad, mun: params.municipio, loc: params.localidad }) : zoneLabel({ ent: params.entidad });
    return params ? [{ ...r, params, watch: !!r.watch, news: news.get(r.id) ?? 0 }] : [];
  });
}
export const getSearch = (id: number) => savedSearches().find((s) => s.id === id);

/** Enregistre (ou remplace) une recherche ; les CLEE déjà affichés servent de base à la veille (pas « nouveaux »). */
export function saveSearch(input: { id?: number; name: string; params: SearchParamsIn; watch: boolean; seen?: string[] }): number {
  const params: SearchParams = SearchParamsSchema.parse(input.params);
  return db.transaction(() => {
    let id = input.id ?? 0;
    if (id && db.prepare("SELECT 1 FROM denue_searches WHERE id=?").get(id)) {
      db.prepare("UPDATE denue_searches SET name=?, params=?, watch=? WHERE id=?").run(input.name, JSON.stringify(params), input.watch ? 1 : 0, id);
    } else {
      id = Number(db.prepare("INSERT INTO denue_searches(name, params, watch, created_at) VALUES(?,?,?,?)").run(input.name, JSON.stringify(params), input.watch ? 1 : 0, now()).lastInsertRowid);
    }
    markSeen(id, input.seen ?? []);
    return id;
  })();
}
export function setWatch(id: number, watch: boolean) { db.prepare("UPDATE denue_searches SET watch=? WHERE id=?").run(watch ? 1 : 0, id); }
export function deleteSearch(id: number) { db.prepare("DELETE FROM denue_searches WHERE id=?").run(id); }

function markSeen(id: number, clees: string[]) {
  const st = db.prepare("INSERT INTO denue_seen(search_id, clee, first_seen, is_new) VALUES(?,?,?,0) ON CONFLICT DO NOTHING");
  const t = now();
  for (const c of clees) if (c) st.run(id, c, t);
}

/** Nouveaux établissements (veille) non encore traités, par recherche (ceux déjà dans le CRM sont exclus). */
export function newCounts(): Map<number, number> {
  const find = existingIndex();
  const m = new Map<number, number>();
  for (const r of db.prepare("SELECT search_id, row FROM denue_seen WHERE is_new = 1").iterate() as Iterable<{ search_id: number; row: string }>) {
    try { if (find(JSON.parse(r.row) as DenueRow)) continue; } catch { continue; }
    m.set(r.search_id, (m.get(r.search_id) ?? 0) + 1);
  }
  return m;
}
export const totalNew = () => [...newCounts().values()].reduce((a, b) => a + b, 0);

export function newRows(id: number): DenueRow[] {
  return (db.prepare("SELECT row FROM denue_seen WHERE search_id = ? AND is_new = 1 ORDER BY first_seen DESC").all(id) as { row: string }[])
    .flatMap((r) => { try { return [JSON.parse(r.row) as DenueRow]; } catch { return []; } });
}
/** « Marquer comme vus » : les nouveaux restent connus mais ne sont plus signalés. */
export function dismissNew(id: number, clees?: string[]) {
  if (clees) { const st = db.prepare("UPDATE denue_seen SET is_new=0 WHERE search_id=? AND clee=?"); db.transaction(() => clees.forEach((c) => st.run(id, c)))(); }
  else db.prepare("UPDATE denue_seen SET is_new=0 WHERE search_id=?").run(id);
}

/**
 * Relance une recherche enregistrée. Premier passage (aucun CLEE connu) : tout devient la base, rien n'est « nouveau ».
 * Ensuite, seuls les CLEE jamais vus sont enregistrés comme nouveaux (avec la fiche DENUE, pour validation).
 */
export async function runSaved(id: number): Promise<{ total: number; fresh: number; error?: string }> {
  const s = db.prepare("SELECT * FROM denue_searches WHERE id=?").get(id) as Row | undefined;
  const params = s && parseParams(s.params);
  if (!s || !params) return { total: 0, fresh: 0, error: "Recherche introuvable." };
  try {
    const r = await runSearch(params);
    const t = now();
    const known = (db.prepare("SELECT COUNT(*) n FROM denue_seen WHERE search_id=?").get(id) as { n: number }).n;
    let fresh = 0;
    db.transaction(() => {
      const ins = db.prepare("INSERT INTO denue_seen(search_id, clee, first_seen, is_new, row) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING");
      for (const row of r.rows) fresh += ins.run(id, row.clee, t, known ? 1 : 0, known ? JSON.stringify(row) : null).changes;
      db.prepare("UPDATE denue_searches SET last_run_at=?, last_total=?, last_error=? WHERE id=?").run(t, r.rows.length, r.partial ?? "", id);
    })();
    return { total: r.rows.length, fresh: known ? fresh : 0, error: r.partial };
  } catch (e) {
    db.prepare("UPDATE denue_searches SET last_run_at=?, last_error=? WHERE id=?").run(now(), (e as Error).message.slice(0, 300), id);
    return { total: 0, fresh: 0, error: (e as Error).message };
  }
}

// ---------- Tâche planifiée : chaque semaine ----------
const WEEK_MS = 7 * 24 * 3600_000;
const CHECK_MS = 60 * 60_000;
const W = (globalThis as unknown as { __watch?: { started: boolean; running: boolean; timer?: ReturnType<typeof setTimeout> } });
const S = W.__watch ?? (W.__watch = { started: false, running: false });

/** Recherches en veille dont la dernière exécution date de plus de 7 jours. */
export const dueSearches = (at = Date.now()) =>
  (db.prepare("SELECT id, last_run_at FROM denue_searches WHERE watch = 1 ORDER BY COALESCE(last_run_at, '') , id").all() as { id: number; last_run_at: string | null }[])
    .filter((s) => !s.last_run_at || at - Date.parse(s.last_run_at) >= WEEK_MS).map((s) => s.id);

export async function watchTick(): Promise<number> {
  if (S.running || !denueToken()) return 0;
  S.running = true;
  let n = 0;
  try {
    for (const id of dueSearches()) {
      const r = await runSaved(id);
      n++;
      console.log(`[bedolt-crm] veille DENUE : recherche ${id} → ${r.total} établissements, ${r.fresh} nouveaux${r.error ? ` (${r.error})` : ""}`);
    }
  } catch (e) {
    console.error("[bedolt-crm] veille DENUE : erreur", e);
  } finally { S.running = false; }
  return n;
}

/** Démarre la vérification horaire (instrumentation.ts). DENUE_WATCH=off la désactive. */
export function startDenueWatch() {
  if (S.started || process.env.DENUE_WATCH === "off") return;
  S.started = true;
  const loop = (ms: number) => { S.timer = setTimeout(async () => { await watchTick(); loop(CHECK_MS); }, ms); S.timer.unref?.(); };
  loop(60_000);
  console.log("[bedolt-crm] veille DENUE : vérification toutes les heures (recherches en veille relancées tous les 7 jours)");
}

// ---------- Marché : mes niches × municipios ----------
export type MarketCell = { denue: number | null; crm: number; contactes: number; clients: number };
export type Market = {
  niches: { label: string; codes: string[] }[]; municipios: { code: string; nom: string }[]; cells: Record<string, MarketCell>;
  estrato: string; entidad: string; par: "municipio" | "etat"; truncated: number; error?: string;
};

const CONTACTED = new Set(["contacte", "a_repondu", "interesse", "paye", "perdu"]);
export const MAX_MARKET_COLS = 60;

/**
 * Mes niches × municipios d'un État (défaut : Quintana Roo), ou × les 32 États (`par = "etat"`).
 * Cuantificar en une requête (par paquets de 40 activités), en cache 24 h ; fiches du CRM par État / municipio.
 */
export async function market(estrato = "0", entidad = ENTIDAD, par: "municipio" | "etat" = "municipio"): Promise<Market> {
  const list = niches().map((n) => ({ label: n.label, codes: dedupeCodes(n.codes) }));
  let cols: { code: string; nom: string }[], truncated = 0;
  if (par === "etat") cols = entidades().map((e) => ({ code: e.c, nom: e.n }));
  else {
    const all = entidad === ENTIDAD ? loadMunicipios().municipios.map((m) => ({ code: m.code, nom: m.nom, p: municipio(entidad, m.code)?.p ?? 0 }))
      : municipiosOf(entidad).map((m) => ({ code: m.m, nom: m.n, p: m.p }));
    // Quintana Roo : ordre habituel (codes) ; autres États : les plus peuplés d'abord (60 au plus)
    const sorted = entidad === ENTIDAD && all.length <= MAX_MARKET_COLS ? all : [...all].sort((a, b) => b.p - a.p).slice(0, MAX_MARKET_COLS);
    truncated = all.length - sorted.length;
    cols = sorted.map(({ code, nom }) => ({ code, nom }));
  }
  const area = (c: string) => (par === "etat" ? c : entidad + c);
  const cells: Record<string, MarketCell> = {};
  const key = (n: string, m: string) => `${n}|${m}`;
  for (const n of list) for (const m of cols) cells[key(n.label, m.code)] = { denue: null, crm: 0, contactes: 0, clients: 0 };
  const rows = db.prepare(`SELECT niche, statut, denue_id, ville, zone, etat_code, municipio_code FROM businesses WHERE niche != '' ${par === "etat" ? "" : "AND etat_code = ?"}`)
    .all(...(par === "etat" ? [] : [entidad])) as { niche: string; statut: string; denue_id: string; ville: string; zone: string; etat_code: string; municipio_code: string }[];
  for (const b of rows) {
    const col = par === "etat" ? b.etat_code : b.municipio_code || (entidad === ENTIDAD ? municipioOf(b) : "");
    const c = cells[key(b.niche, col)];
    if (!c) continue;
    c.crm++;
    if (CONTACTED.has(b.statut)) c.contactes++;
    if (b.statut === "paye") c.clients++;
  }
  let error: string | undefined;
  const all = [...new Set(list.flatMap((n) => n.codes))];
  if (all.length && cols.length && denueToken()) {
    try {
      const counts = new Map<string, number>();
      for (let i = 0; i < all.length; i += 40) {
        for (const r of await cuantificar(all.slice(i, i + 40), cols.map((m) => area(m.code)), estrato)) counts.set(`${r.ae}|${r.ag}`, r.total);
      }
      for (const n of list) for (const m of cols) cells[key(n.label, m.code)].denue = n.codes.reduce((a, c) => a + (counts.get(`${c}|${area(m.code)}`) ?? 0), 0);
    } catch (e) { error = (e as Error).message; }
  } else if (!denueToken()) error = "Token DENUE manquant : configure-le dans Réglages › Sources & clés.";
  return { niches: list, municipios: cols, cells, estrato, entidad, par, truncated, error };
}
