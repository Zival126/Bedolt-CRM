import { db, now, dayOf, today, addDays, weekStart } from "./db";
import { telNorm } from "./phone";
import { DAILY_CALLS, DAILY_WHATSAPP, PER_PAGE } from "./constants";

export type Business = {
  id: number; nom: string; activite: string; telephone: string; whatsapp: string; tel_norm: string; email: string;
  site_web: string; adresse: string; colonia: string; ville: string; lat: number | null; lng: number | null;
  fiche_google: string; lien_google: string; note_google: number | null; nb_avis: number | null;
  source: string; source_detail: string; denue_id: string; notes: string; interet: string;
  statut: string; statut_date: string | null; first_contact_at: string | null; next_followup: string | null;
  score: number | null; score_raison: string; etiquette: string; created_at: string;
  niche: string; offre: string; presence_web: string; angle: string; zone: string; message_whatsapp: string;
  import_batch_id: number | null;
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
const RESPONDED = ["a_repondu", "interesse", "paye", "pas_interesse"];

/** Prochaine relance : J+2 puis J+7 après le premier contact ; null si les deux sont passées. */
export function computeFollowup(firstContactAt: string | null, from: Date = new Date()): string | null {
  if (!firstContactAt) return null;
  const first = dayOf(new Date(firstContactAt));
  const day = dayOf(from);
  for (const n of [2, 7]) {
    const due = addDays(first, n);
    if (day < due) return due;
  }
  return null;
}

export function setStatus(id: number, statut: string) {
  const b = getBusiness(id);
  if (!b || b.statut === statut) return;
  const t = now();
  let first = b.first_contact_at;
  let follow: string | null = null;
  if (statut === "a_contacter") first = null;
  if (statut === "contacte") {
    first = first ?? t;
    follow = computeFollowup(first);
  }
  db.prepare("UPDATE businesses SET statut=?, statut_date=?, first_contact_at=?, next_followup=? WHERE id=?").run(statut, t, first, follow, id);
  db.prepare("INSERT INTO status_history(business_id,statut,at,day) VALUES(?,?,?,?)").run(id, statut, t, today());
  if (statut === "paye") {
    db.prepare("INSERT OR IGNORE INTO clients(business_id, created_at) VALUES(?, ?)").run(id, t);
  }
}

export function logAction(id: number, type: string, content = "") {
  const b = getBusiness(id);
  if (!b) return;
  const t = now();
  db.prepare("INSERT INTO actions(business_id,type,content,at,day) VALUES(?,?,?,?,?)").run(id, type, content, t, today());
  if (type === "whatsapp" || type === "appel_pas_repondu") {
    // Contact sans réponse : on passe en « Contacté » et on (re)programme la relance.
    if (b.statut === "a_contacter") setStatus(id, "contacte");
    else if (b.statut === "contacte") {
      db.prepare("UPDATE businesses SET next_followup=? WHERE id=?").run(computeFollowup(b.first_contact_at), id);
    }
  } else if (type === "appel_repondu" && (b.statut === "a_contacter" || b.statut === "contacte")) {
    setStatus(id, "a_repondu");
  }
  if (RESPONDED.includes(b.statut)) db.prepare("UPDATE businesses SET next_followup=NULL WHERE id=?").run(id);
}

// ---------- Compteurs ----------
export function dayCounts(day = today()) {
  const c = (types: string[]) =>
    (db.prepare(`SELECT COUNT(*) n FROM actions WHERE day=? AND type IN (${types.map(() => "?").join(",")})`).get(day, ...types) as { n: number }).n;
  const calls = c(["appel_repondu", "appel_pas_repondu"]);
  const whatsapp = c(["whatsapp"]);
  return { calls, whatsapp, callsGoal: DAILY_CALLS, whatsappMax: DAILY_WHATSAPP };
}

export function weekStats(start = weekStart()) {
  const end = addDays(start, 6);
  const q = (s: string) =>
    (db.prepare("SELECT COUNT(DISTINCT business_id) n FROM status_history WHERE statut=? AND day BETWEEN ? AND ?").get(s, start, end) as { n: number }).n;
  return { start, end, contacte: q("contacte"), a_repondu: q("a_repondu"), interesse: q("interesse"), paye: q("paye") };
}

export function pipelineCounts(): Record<string, number> {
  const rows = db.prepare("SELECT statut, COUNT(*) n FROM businesses GROUP BY statut").all() as { statut: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.statut, r.n]));
}

// ---------- Listes ----------
export type Filters = {
  q?: string; ville?: string; activite?: string; statut?: string; fiche?: string; sort?: string;
  niche?: string; zone?: string; offre?: string; web?: string; note_min?: string; avis_min?: string; lot?: string; msg?: string;
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
export function bulkSetStatus(ids: number[], statut: string): number {
  let n = 0;
  db.transaction(() => { for (const id of ids) { const b = getBusiness(id); if (b && b.statut !== statut) { setStatus(id, statut); n++; } } })();
  return n;
}
export function bulkSetOffre(ids: number[], offre: string): number {
  const st = db.prepare("UPDATE businesses SET offre = ? WHERE id = ?");
  let n = 0;
  db.transaction(() => { for (const id of ids) n += st.run(offre, id).changes; })();
  return n;
}

export function todayLists() {
  const day = today();
  const followups = db.prepare("SELECT * FROM businesses WHERE statut='contacte' AND next_followup IS NOT NULL AND next_followup <= ? ORDER BY next_followup").all(day) as Business[];
  const toCall = db.prepare(
    `SELECT * FROM businesses WHERE statut='a_contacter' AND (tel_norm != '')
     AND id NOT IN (SELECT business_id FROM actions WHERE day = ?)
     ORDER BY (interet='chaud') DESC, (interet='tiede') DESC, offre = '', offre COLLATE NOCASE, nb_avis IS NULL, nb_avis DESC,
       score IS NULL, score DESC, id LIMIT 15`).all(day) as Business[];
  return { followups, toCall };
}

export const businessActions = (id: number) =>
  db.prepare("SELECT * FROM actions WHERE business_id = ? ORDER BY at DESC").all(id) as { id: number; type: string; content: string; at: string }[];
export const businessHistory = (id: number) =>
  db.prepare("SELECT * FROM status_history WHERE business_id = ? ORDER BY at DESC").all(id) as { id: number; statut: string; at: string }[];
