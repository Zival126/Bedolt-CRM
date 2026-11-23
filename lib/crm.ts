import { db, now, dayOf, today, addDays, weekStart } from "./db";
import { telNorm } from "./phone";
import { PER_PAGE } from "./constants";
import { enqueue, setManualPosition, resetPosition } from "./geocode";

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
  geo_precision: string; geo_source: string; geo_date: string | null;
  facebook: string; instagram: string; wa_confirme: number; ne_pas_contacter: number; dnc_at: string | null;
  denue_num: string; denue_alta: string; denue_estrato: string; denue_sync: string | null;
};

export const getBusiness = (id: number) =>
  db.prepare("SELECT * FROM businesses WHERE id = ?").get(id) as Business | undefined;

// ---------- Création / édition ----------
const FIELDS = ["nom", "activite", "telephone", "whatsapp", "email", "site_web", "adresse", "colonia", "ville", "lat", "lng",
  "fiche_google", "lien_google", "note_google", "nb_avis", "source", "source_detail", "denue_id", "notes", "interet",
  "niche", "offre", "presence_web", "angle", "zone", "message_whatsapp", "facebook", "instagram",
  "denue_num", "denue_alta", "denue_estrato", "denue_sync"] as const;
type Input = Partial<Pick<Business, (typeof FIELDS)[number]>> & { nom: string };

export function insertBusiness(input: Input): number {
  const t = now();
  const v: Record<string, unknown> = { source: "manuel", ...input };
  v.tel_norm = telNorm(input.telephone) || telNorm(input.whatsapp);
  const cols = [...FIELDS.filter((f) => v[f] !== undefined), "tel_norm", "statut", "statut_date", "created_at"];
  const vals = [...FIELDS.filter((f) => v[f] !== undefined).map((f) => v[f]), v.tel_norm, "a_contacter", t, t];
  if (input.lat != null && input.lng != null) {
    // Position fournie (DENUE, saisie) : précision « commerce », jamais écrasée par le géocodage.
    cols.push("geo_precision", "geo_source", "geo_date");
    vals.push("commerce", v.source === "DENUE" ? "denue" : v.source === "Excel" ? "import" : "manuel", t);
  }
  const id = Number(db.prepare(`INSERT INTO businesses(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`).run(...vals).lastInsertRowid);
  db.prepare("INSERT INTO status_history(business_id,statut,at,day) VALUES(?,?,?,?)").run(id, "a_contacter", t, today());
  if (input.lat == null || input.lng == null) enqueue([id]);
  return id;
}

/** Champs dont dépend le géocodage automatique : s'ils changent, une position OpenStreetMap est recalculée. */
const GEO_INPUTS = ["nom", "adresse", "colonia", "ville", "zone", "lien_google"] as const;

export function updateBusiness(id: number, input: Partial<Input>) {
  const before = getBusiness(id);
  if (!before) return;
  // Position : lat/lng modifiés dans le formulaire → position manuelle ; effacés → retour au géocodage automatique.
  const geo = { ...input };
  delete geo.lat; delete geo.lng;
  let geoAction: "manual" | "reset" | "requeue" | null = null;
  if (input.lat !== undefined || input.lng !== undefined) {
    const lat = input.lat === undefined ? before.lat : input.lat, lng = input.lng === undefined ? before.lng : input.lng;
    if (lat == null || lng == null) { if (before.lat != null) geoAction = "reset"; }
    else if (lat !== before.lat || lng !== before.lng) geoAction = "manual";
  }
  if (!geoAction && GEO_INPUTS.some((k) => input[k] !== undefined && String(input[k] ?? "").trim() !== String(before[k] ?? "").trim())
    && (before.geo_source === "nominatim" || before.lat == null)) geoAction = "requeue";
  const keys = FIELDS.filter((f) => geo[f] !== undefined);
  const input2 = geo;
  if (keys.length) writeFields(id, keys, input2, before);
  if (geoAction === "manual") setManualPosition(id, (input.lat ?? before.lat)!, (input.lng ?? before.lng)!);
  else if (geoAction === "reset" || geoAction === "requeue") resetPosition(id);
}

function writeFields(id: number, keys: (typeof FIELDS)[number][], input: Partial<Input>, cur: Business) {
  const sets = keys.map((k) => `${k} = ?`);
  const vals: unknown[] = keys.map((k) => input[k]);
  if (input.telephone !== undefined || input.whatsapp !== undefined) {
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
  /** « 1 » : seulement les fiches de la file du jour (ids résolus par l'appelant dans `idIn`). */
  file?: string;
  /** Contacts (v5) : « 1 » avec / « 0 » sans. */
  email?: string; site?: string; tel?: string; pos?: string;
  /** WhatsApp : oui | non | inconnu. */
  wa?: string;
  /** Source : Excel | DENUE | manuel. */
  source?: string;
  /** Ne pas contacter : « 1 » seulement elles, « 0 » les exclure (défaut de la carte), absent = toutes. */
  dnc?: string;
  /** Étiquette (une parmi celles de la fiche, séparées par des virgules). */
  tag?: string;
  /** Sens du tri : asc | desc (défaut propre à chaque tri). */
  dir?: string;
  /** Interne : restreint aux identifiants donnés (file du jour). */
  idIn?: number[];
};
export const SORTS = [
  { key: "offre", label: "Offre (P1→P3)" }, { key: "avis", label: "Nb d'avis" }, { key: "note", label: "Note Google" },
  { key: "recent", label: "Date d'ajout" }, { key: "score", label: "Score IA" }, { key: "nom", label: "Nom" },
] as const;
/** Tris supplémentaires (en-têtes du tableau). */
export const COLUMN_SORTS = ["ville", "niche", "zone", "statut", "email", "site", "tel", "source", "colonia"] as const;

// [ordre par défaut, ordre inverse] ; valeurs vides / nulles toujours en dernier
const ORDER: Record<string, [string, string]> = {
  // offre vide en dernier, puis P1, P2, P3 ; à offre égale, le plus d'avis d'abord
  offre: ["offre = '', offre COLLATE NOCASE, nb_avis IS NULL, nb_avis DESC, id", "offre = '', offre COLLATE NOCASE DESC, nb_avis IS NULL, nb_avis DESC, id"],
  avis: ["nb_avis IS NULL, nb_avis DESC, id", "nb_avis IS NULL, nb_avis ASC, id"],
  note: ["note_google IS NULL, note_google DESC, nb_avis IS NULL, nb_avis DESC, id", "note_google IS NULL, note_google ASC, id"],
  recent: ["id DESC", "id ASC"],
  score: ["score IS NULL, score DESC, id", "score IS NULL, score ASC, id"],
  nom: ["nom COLLATE NOCASE, id", "nom COLLATE NOCASE DESC, id"],
  statut: [`CASE statut ${["a_contacter", "contacte", "a_repondu", "interesse", "paye", "perdu"].map((k, i) => `WHEN '${k}' THEN ${i}`).join(" ")} ELSE 9 END, id`,
    `CASE statut ${["a_contacter", "contacte", "a_repondu", "interesse", "paye", "perdu"].map((k, i) => `WHEN '${k}' THEN ${9 - i}`).join(" ")} ELSE 9 END, id`],
};
const text = (col: string): [string, string] => [`${col} = '', ${col} COLLATE NOCASE, id`, `${col} = '', ${col} COLLATE NOCASE DESC, id`];
for (const [k, col] of [["ville", "ville"], ["niche", "niche"], ["zone", "zone"], ["email", "email"], ["site", "site_web"], ["tel", "tel_norm"], ["source", "source"], ["colonia", "colonia"]]) ORDER[k] = text(col);
const orderOf = (f: Filters) => (ORDER[f.sort ?? ""] ?? ORDER.recent)[f.dir === "inv" ? 1 : 0];

/** Clause WHERE paramétrée. `skip` : dimension ignorée (pour les compteurs par niche / zone). */
export function whereOf(f: Filters, skip?: keyof Filters): { sql: string; args: unknown[] } {
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
  if (has("statut")) {
    if (f.statut === "actifs") where.push("statut != 'perdu'");   // tous sauf Perdu (défaut de la carte)
    else { where.push("statut = ?"); args.push(f.statut); }
  }
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
  if (has("nowa")) where.push("no_whatsapp = 1 AND tel_norm != '' AND statut NOT IN ('perdu','paye') AND ne_pas_contacter = 0");
  const yesNo = (k: "email" | "site" | "tel" | "pos", yes: string, no: string) => { if (has(k) && (f[k] === "1" || f[k] === "0")) where.push(f[k] === "1" ? yes : no); };
  yesNo("email", "email != ''", "email = ''");
  yesNo("site", "site_web != ''", "site_web = ''");
  yesNo("tel", "tel_norm != ''", "tel_norm = ''");
  yesNo("pos", "lat IS NOT NULL AND lng IS NOT NULL", "(lat IS NULL OR lng IS NULL)");
  if (has("wa")) {
    if (f.wa === "oui") where.push("no_whatsapp = 0 AND wa_confirme = 1");
    else if (f.wa === "non") where.push("no_whatsapp = 1");
    else if (f.wa === "inconnu") where.push("no_whatsapp = 0 AND wa_confirme = 0");
  }
  if (has("source")) { where.push("source = ? COLLATE NOCASE"); args.push(f.source); }
  if (has("dnc") && (f.dnc === "1" || f.dnc === "0")) where.push(`ne_pas_contacter = ${f.dnc === "1" ? 1 : 0}`);
  if (has("tag")) { where.push("(',' || REPLACE(REPLACE(etiquette, ', ', ','), ' ,', ',') || ',') LIKE ?"); args.push(`%,${f.tag!.replace(/[%_,]/g, "")},%`); }
  if (f.idIn) { where.push(f.idIn.length ? `id IN (${f.idIn.map(() => "?").join(",")})` : "0"); args.push(...f.idIn); }
  return { sql: where.length ? "WHERE " + where.join(" AND ") : "", args };
}

/** Liste paginée côté serveur + nombre total (jamais de troncature silencieuse). */
export function queryBusinesses(f: Filters, page = 1, perPage = PER_PAGE): { rows: Business[]; total: number; page: number; pages: number } {
  const w = whereOf(f);
  const total = (db.prepare(`SELECT COUNT(*) n FROM businesses ${w.sql}`).get(...w.args) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const rows = db.prepare(`SELECT * FROM businesses ${w.sql} ORDER BY ${orderOf(f)} LIMIT ? OFFSET ?`)
    .all(...w.args, perPage, (p - 1) * perPage) as Business[];
  return { rows, total, page: p, pages };
}

/** Identifiants correspondant à un filtre (actions groupées « toutes les fiches du filtre »). */
export function idsForFilter(f: Filters, max = 5000): number[] {
  const w = whereOf(f);
  return (db.prepare(`SELECT id FROM businesses ${w.sql} ORDER BY ${orderOf(f)} LIMIT ?`).all(...w.args, max) as { id: number }[]).map((r) => r.id);
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

export const distinct = (col: "ville" | "activite" | "niche" | "zone" | "offre" | "presence_web" | "source") =>
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

/** Ajoute une étiquette (liste séparée par des virgules) sans doublon. */
export function bulkAddTag(ids: number[], tag: string): number {
  const t = tag.trim().replace(/,/g, " ").slice(0, 60);
  if (!t) return 0;
  const get = db.prepare("SELECT etiquette FROM businesses WHERE id = ?");
  const set = db.prepare("UPDATE businesses SET etiquette = ? WHERE id = ?");
  let n = 0;
  db.transaction(() => {
    for (const id of ids) {
      const r = get.get(id) as { etiquette: string } | undefined;
      if (!r) continue;
      const tags = tagsOf(r.etiquette);
      if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
      set.run([...tags, t].join(", ").slice(0, 200), id); n++;
    }
  })();
  return n;
}
export const tagsOf = (s: string) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
export const allTags = () => [...new Set((db.prepare("SELECT etiquette FROM businesses WHERE etiquette != ''").all() as { etiquette: string }[]).flatMap((r) => tagsOf(r.etiquette)))].sort((a, b) => a.localeCompare(b, "fr"));

/** « Ne pas contacter » : exclu de toutes les files, de la carte par défaut et des envois WhatsApp. */
export function setDnc(ids: number[], on: boolean): number {
  const st = db.prepare("UPDATE businesses SET ne_pas_contacter = ?, dnc_at = ? WHERE id = ? AND ne_pas_contacter != ?");
  const t = on ? now() : null;
  let n = 0;
  db.transaction(() => {
    for (const id of ids) n += st.run(on ? 1 : 0, t, id, on ? 1 : 0).changes;
    if (on && ids.length) {
      // Retirées de la file du jour non traitée
      const del = db.prepare("DELETE FROM daily_queue WHERE business_id = ? AND done_at IS NULL");
      for (const id of ids) del.run(id);
    }
  })();
  return n;
}

/** État WhatsApp affiché : non (marqué sans WhatsApp) > oui (envoi réussi / saisi) > inconnu. */
export const waState = (b: Pick<Business, "no_whatsapp" | "wa_confirme">): "oui" | "non" | "inconnu" => (b.no_whatsapp ? "non" : b.wa_confirme ? "oui" : "inconnu");

export type ActionRow = { id: number; type: string; content: string; at: string; step: string; result: string };
export const businessActions = (id: number, limit = 500) =>
  db.prepare("SELECT * FROM actions WHERE business_id = ? ORDER BY at DESC, id DESC LIMIT ?").all(id, limit) as ActionRow[];
export const businessHistory = (id: number) =>
  db.prepare("SELECT * FROM status_history WHERE business_id = ? ORDER BY at DESC, id DESC").all(id) as { id: number; statut: string; at: string; motif: string }[];
