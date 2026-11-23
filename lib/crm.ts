import { db, now, dayOf, today, addDays, weekStart } from "./db";
import { telNorm } from "./phone";
import { PER_PAGE } from "./constants";

export type Business = {
  id: number; nom: string; activite: string; telephone: string; whatsapp: string; tel_norm: string; email: string;
  site_web: string; adresse: string; colonia: string; ville: string; lat: number | null; lng: number | null;
  fiche_google: string; lien_google: string; note_google: number | null; nb_avis: number | null;
  source: string; source_detail: string; denue_id: string; notes: string; interet: string;
  statut: string; statut_date: string | null; first_contact_at: string | null; next_followup: string | null;
  score: number | null; score_raison: string; etiquette: string; created_at: string;
  niche: string; offre: string; presence_web: string; angle: string; zone: string; message_whatsapp: string;
  import_batch_id: number | null;
  perdu_motif: string; no_whatsapp: number; relance_n: number; next_step: string; next_date: string | null;
};

export const getBusiness = (id: number) =>
  db.prepare("SELECT * FROM businesses WHERE id = ?").get(id) as Business | undefined;

// ---------- Création / édition ----------
const FIELDS = ["nom", "activite", "telephone", "whatsapp", "email", "site_web", "adresse", "colonia", "ville", "lat", "lng",
  "fiche_google", "lien_google", "note_google", "nb_avis", "source", "source_detail", "denue_id", "notes", "interet",
  "niche", "offre", "presence_web", "angle", "zone", "message_whatsapp"] as const;
type Input = Partial<Pick<Business, (typeof FIELDS)[number]>> & { nom: string };

export function insertBusiness(input: Input): number {
  const t = now();
  const v: Record<string, unknown> = { source: "manuel", ...input };
  v.tel_norm = telNorm(input.telephone) || telNorm(input.whatsapp);
  const cols = [...FIELDS.filter((f) => v[f] !== undefined), "tel_norm", "statut", "statut_date", "created_at"];
  const vals = [...FIELDS.filter((f) => v[f] !== undefined).map((f) => v[f]), v.tel_norm, "a_contacter", t, t];
  const id = Number(db.prepare(`INSERT INTO businesses(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`).run(...vals).lastInsertRowid);
  db.prepare("INSERT INTO status_history(business_id,statut,at,day) VALUES(?,?,?,?)").run(id, "a_contacter", t, today());
  return id;
}

export function updateBusiness(id: number, input: Partial<Input>) {
  const keys = FIELDS.filter((f) => input[f] !== undefined);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`);
  const vals: unknown[] = keys.map((k) => input[k]);
  if (input.telephone !== undefined || input.whatsapp !== undefined) {
    const cur = getBusiness(id)!;
    sets.push("tel_norm = ?");
    vals.push(telNorm(input.telephone ?? cur.telephone) || telNorm(input.whatsapp ?? cur.whatsapp));
  }
  db.prepare(`UPDATE businesses SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function deleteBusiness(id: number) {
  db.prepare("DELETE FROM businesses WHERE id = ?").run(id);
}

// ---------- Dédoublonnage ----------
/** Cherche un commerce existant : ID DENUE, puis téléphone normalisé, puis (option) nom + ville. */
export function findDuplicate(c: { denue_id?: string; telephone?: string; whatsapp?: string; nom?: string; ville?: string }, byName = false): Business | undefined {
  if (c.denue_id) {
    const r = db.prepare("SELECT * FROM businesses WHERE denue_id = ?").get(c.denue_id) as Business | undefined;
    if (r) return r;
  }
  for (const t of [telNorm(c.telephone), telNorm(c.whatsapp)]) {
    if (t) {
      const r = db.prepare("SELECT * FROM businesses WHERE tel_norm = ?").get(t) as Business | undefined;
      if (r) return r;
    }
  }
  if (byName && c.nom) {
    return db.prepare("SELECT * FROM businesses WHERE lower(nom) = lower(?) AND lower(ville) = lower(?)").get(c.nom.trim(), (c.ville ?? "").trim()) as Business | undefined;
  }
  return undefined;
}

// ---------- Pipeline ----------
/**
 * Changement de statut « brut » (Kanban, menu de la fiche, import, actions groupées) avec les règles du cycle de vie :
 * - À contacter : remet à zéro le premier contact et les relances ;
 * - Contacté : premier contact = maintenant s'il manque, relance J+2 programmée si aucune ;
 * - A répondu et au-delà : plus de relance ; Perdu : plus de relance ni de date, motif enregistré.
 * Les résultats en 1 clic passent par lib/outcomes.ts (qui appelle cette fonction).
 */
export function setStatus(id: number, statut: string, motif = "") {
  const b = getBusiness(id);
  if (!b || (b.statut === statut && (statut !== "perdu" || b.perdu_motif === motif))) return;
  const t = now(), day = today();
  let first = b.first_contact_at, follow: string | null = null, relance = b.relance_n ?? 0;
  let nextDate = b.next_date, nextStep = b.next_step;
  if (statut === "a_contacter") { first = null; relance = 0; nextDate = null; nextStep = ""; }
  if (statut === "contacte") {
    first = first ?? t;
    follow = b.statut === "contacte" && b.next_followup ? b.next_followup : addDays(day, 2);
    if (b.statut !== "contacte") relance = 0;
  }
  if (statut === "perdu") { nextDate = null; }
  db.prepare("UPDATE businesses SET statut=?, statut_date=?, first_contact_at=?, next_followup=?, relance_n=?, next_date=?, next_step=?, perdu_motif=? WHERE id=?")
    .run(statut, t, first, follow, relance, nextDate, nextStep, statut === "perdu" ? motif || "autre" : "", id);
  db.prepare("INSERT INTO status_history(business_id,statut,at,day,motif) VALUES(?,?,?,?,?)").run(id, statut, t, day, statut === "perdu" ? motif || "autre" : "");
  if (statut === "paye") {
    db.prepare("INSERT OR IGNORE INTO clients(business_id, created_at) VALUES(?, ?)").run(id, t);
  }
}

/** Journalise une action (date, type, résultat, étape de la file). Aucun effet sur le statut : voir lib/outcomes.ts. */
export function logAction(id: number, type: string, content = "", step = "", result = ""): number {
  if (!getBusiness(id)) return 0;
  return Number(db.prepare("INSERT INTO actions(business_id,type,content,at,day,step,result) VALUES(?,?,?,?,?,?,?)")
    .run(id, type, content, now(), today(), step, result).lastInsertRowid);
}

// ---------- Compteurs ----------
/** Compteurs du jour (fuseau America/Cancun) : nouveaux WhatsApp, relances traitées, réponses reçues. */
export function dayCounts(day = today()) {
  const n = (sql: string) => (db.prepare(sql).get(day) as { n: number }).n;
  return {
    newWa: n("SELECT COUNT(*) n FROM actions WHERE day=? AND type='whatsapp' AND step='first'"),
    relances: n("SELECT COUNT(DISTINCT business_id) n FROM actions WHERE day=? AND step IN ('j2','j7','fin')"),
    replies: n("SELECT COUNT(DISTINCT business_id) n FROM actions WHERE day=? AND type IN ('repondu','appel_repondu')"),
    calls: n("SELECT COUNT(*) n FROM actions WHERE day=? AND type IN ('appel_repondu','appel_pas_repondu')"),
  };
}

/**
 * Entonnoir d'une semaine (lundi → dimanche) : commerces ayant atteint chaque étape pendant la semaine (historique des
 * statuts), taux de réponse, perdus par motif (« Pas intéressé » d'avant la v3 compté dans son motif).
 */
export function weekStats(start = weekStart()) {
  const end = addDays(start, 6);
  const q = (statuts: string[]) =>
    (db.prepare(`SELECT COUNT(DISTINCT business_id) n FROM status_history WHERE statut IN (${statuts.map(() => "?").join(",")}) AND day BETWEEN ? AND ?`)
      .get(...statuts, start, end) as { n: number }).n;
  const contacte = q(["contacte"]);
  const replied = (db.prepare(`SELECT COUNT(DISTINCT business_id) n FROM (
      SELECT business_id FROM status_history WHERE statut='a_repondu' AND day BETWEEN ? AND ?
      UNION SELECT business_id FROM actions WHERE type IN ('repondu','appel_repondu') AND day BETWEEN ? AND ?)`).get(start, end, start, end) as { n: number }).n;
  const perdus = db.prepare(`SELECT CASE WHEN statut='pas_interesse' THEN 'pas_interesse' ELSE COALESCE(NULLIF(motif,''),'autre') END motif, COUNT(DISTINCT business_id) n
    FROM status_history WHERE statut IN ('perdu','pas_interesse') AND day BETWEEN ? AND ? GROUP BY 1 ORDER BY n DESC`).all(start, end) as { motif: string; n: number }[];
  return {
    start, end, contacte, a_repondu: replied, interesse: q(["interesse"]), paye: q(["paye"]),
    taux: contacte ? replied / contacte : null, perdus, perdusTotal: perdus.reduce((a, p) => a + p.n, 0),
  };
}

/** Perdus actuels (fiches au statut Perdu) par motif. */
export const lostByMotif = () =>
  db.prepare("SELECT COALESCE(NULLIF(perdu_motif,''),'autre') motif, COUNT(*) n FROM businesses WHERE statut='perdu' GROUP BY 1 ORDER BY n DESC").all() as { motif: string; n: number }[];

export function pipelineCounts(): Record<string, number> {
  const rows = db.prepare("SELECT statut, COUNT(*) n FROM businesses GROUP BY statut").all() as { statut: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.statut, r.n]));
}

// ---------- Listes ----------
export type Filters = {
  q?: string; ville?: string; activite?: string; statut?: string; fiche?: string; sort?: string;
  niche?: string; zone?: string; offre?: string; web?: string; note_min?: string; avis_min?: string; lot?: string; msg?: string;
  /** « 1 » : liste À appeler (numéro sans WhatsApp, fiche ni perdue ni payée). */
  nowa?: string;
};
export const SORTS = [
  { key: "offre", label: "Offre (P1→P3)" }, { key: "avis", label: "Nb d'avis" }, { key: "note", label: "Note Google" },
  { key: "recent", label: "Date d'ajout" }, { key: "score", label: "Score IA" }, { key: "nom", label: "Nom" },
] as const;

const ORDER: Record<string, string> = {
  // offre vide en dernier, puis P1, P2, P3 ; à offre égale, le plus d'avis d'abord
  offre: "offre = '', offre COLLATE NOCASE, nb_avis IS NULL, nb_avis DESC, id",
  avis: "nb_avis IS NULL, nb_avis DESC, id",
  note: "note_google IS NULL, note_google DESC, nb_avis IS NULL, nb_avis DESC, id",
  recent: "id DESC",
  score: "score IS NULL, score DESC, id",
  nom: "nom COLLATE NOCASE, id",
};

/** Clause WHERE paramétrée. `skip` : dimension ignorée (pour les compteurs par niche / zone). */
function whereOf(f: Filters, skip?: keyof Filters): { sql: string; args: unknown[] } {
  const where: string[] = [], args: unknown[] = [];
  const has = (k: keyof Filters) => k !== skip && f[k] !== undefined && f[k] !== "";
  if (has("q")) {
    const q = f.q!.trim();
    const digits = q.replace(/\D/g, "");
    where.push(digits.length >= 4 ? "(nom LIKE ? OR tel_norm LIKE ? OR telephone LIKE ?)" : "nom LIKE ?");
    args.push(`%${q}%`);
    if (digits.length >= 4) args.push(`%${digits.slice(-10)}%`, `%${q}%`);
  }
  if (has("ville")) { where.push("ville = ? COLLATE NOCASE"); args.push(f.ville); }
  if (has("activite")) { where.push("activite LIKE ?"); args.push(`%${f.activite}%`); }
  if (has("statut")) { where.push("statut = ?"); args.push(f.statut); }
  if (has("fiche")) { where.push(f.fiche === "none" ? "fiche_google = ''" : "fiche_google = ?"); if (f.fiche !== "none") args.push(f.fiche); }
  for (const k of ["niche", "zone", "offre", "web"] as const) {
    if (!has(k)) continue;
    const col = k === "web" ? "presence_web" : k;
    if (f[k] === "none") where.push(`${col} = ''`);
    else { where.push(`${col} = ? COLLATE NOCASE`); args.push(f[k]); }
  }
  if (has("note_min") && !isNaN(Number(f.note_min))) { where.push("note_google >= ?"); args.push(Number(f.note_min)); }
  if (has("avis_min") && !isNaN(Number(f.avis_min))) { where.push("nb_avis >= ?"); args.push(Number(f.avis_min)); }
  if (has("lot") && Number(f.lot) > 0) { where.push("import_batch_id = ?"); args.push(Number(f.lot)); }
  if (has("msg")) where.push(f.msg === "0" ? "message_whatsapp = ''" : "message_whatsapp != ''");
  if (has("nowa")) where.push("no_whatsapp = 1 AND tel_norm != '' AND statut NOT IN ('perdu','paye')");
  return { sql: where.length ? "WHERE " + where.join(" AND ") : "", args };
}

/** Liste paginée côté serveur + nombre total (jamais de troncature silencieuse). */
export function queryBusinesses(f: Filters, page = 1, perPage = PER_PAGE): { rows: Business[]; total: number; page: number; pages: number } {
  const w = whereOf(f);
  const total = (db.prepare(`SELECT COUNT(*) n FROM businesses ${w.sql}`).get(...w.args) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const rows = db.prepare(`SELECT * FROM businesses ${w.sql} ORDER BY ${ORDER[f.sort ?? ""] ?? ORDER.recent} LIMIT ? OFFSET ?`)
    .all(...w.args, perPage, (p - 1) * perPage) as Business[];
  return { rows, total, page: p, pages };
}

/** Identifiants correspondant à un filtre (actions groupées « toutes les fiches du filtre »). */
export function idsForFilter(f: Filters, max = 5000): number[] {
  const w = whereOf(f);
  return (db.prepare(`SELECT id FROM businesses ${w.sql} ORDER BY ${ORDER[f.sort ?? ""] ?? ORDER.recent} LIMIT ?`).all(...w.args, max) as { id: number }[]).map((r) => r.id);
}

/** Compteurs par valeur d'une colonne, avec les autres filtres appliqués (résumé cliquable en haut de liste). */
export function facet(f: Filters, dim: "niche" | "zone" | "statut", limit = 40): { v: string; n: number }[] {
  const w = whereOf(f, dim);
  return db.prepare(`SELECT ${dim} v, COUNT(*) n FROM businesses ${w.sql} GROUP BY ${dim} ORDER BY n DESC, v LIMIT ?`).all(...w.args, limit) as { v: string; n: number }[];
}

/** Compatibilité (outils IA) : liste plafonnée explicitement par l'appelant. */
export function listBusinesses(f: Filters, limit = 300): Business[] {
  return queryBusinesses(f, 1, limit).rows;
}

export const distinct = (col: "ville" | "activite" | "niche" | "zone" | "offre" | "presence_web") =>
  (db.prepare(`SELECT DISTINCT ${col} v FROM businesses WHERE ${col} != '' ORDER BY ${col} COLLATE NOCASE`).all() as { v: string }[]).map((r) => r.v);

export const importBatches = (limit = 20) =>
  db.prepare("SELECT b.*, (SELECT COUNT(*) FROM businesses WHERE import_batch_id = b.id) AS remaining FROM import_batches b ORDER BY id DESC LIMIT ?").all(limit) as ImportBatch[];
export type ImportBatch = {
  id: number; file_name: string; format: string; created_at: string; added: number; updated: number; ignored: number; errors: number;
  duration_ms: number | null; cancelled_at: string | null; cancelled_deleted: number | null; cancelled_kept: number | null; remaining: number;
};

// ---------- Actions groupées ----------
export function bulkSetStatus(ids: number[], statut: string, motif = "autre"): number {
  let n = 0;
  db.transaction(() => { for (const id of ids) { const b = getBusiness(id); if (b && b.statut !== statut) { setStatus(id, statut, statut === "perdu" ? motif : ""); n++; } } })();
  return n;
}
export function bulkSetOffre(ids: number[], offre: string): number {
  const st = db.prepare("UPDATE businesses SET offre = ? WHERE id = ?");
  let n = 0;
  db.transaction(() => { for (const id of ids) n += st.run(offre, id).changes; })();
  return n;
}

export type ActionRow = { id: number; type: string; content: string; at: string; step: string; result: string };
export const businessActions = (id: number, limit = 500) =>
  db.prepare("SELECT * FROM actions WHERE business_id = ? ORDER BY at DESC, id DESC LIMIT ?").all(id, limit) as ActionRow[];
export const businessHistory = (id: number) =>
  db.prepare("SELECT * FROM status_history WHERE business_id = ? ORDER BY at DESC, id DESC").all(id) as { id: number; statut: string; at: string; motif: string }[];
