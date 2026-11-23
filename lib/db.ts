import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { TZ } from "./constants";

const file = path.resolve(process.env.DATABASE_PATH || "./data/crm.db");
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

/** Version du schéma (PRAGMA user_version), déclarée avant l'ouverture de la base (utilisée par migrate()). */
export const SCHEMA_VERSION = 3;

// Dates (déclarées avant l'ouverture de la base : la migration v3 les utilise).
export const now = () => new Date().toISOString();
/** Date locale (YYYY-MM-DD) dans le fuseau de la Riviera Maya. */
export const dayOf = (d: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const today = () => dayOf();
export const addDays = (day: string, n: number) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Lundi de la semaine contenant `day`. */
export const weekStart = (day: string = today()) => {
  const dow = new Date(day + "T12:00:00Z").getUTCDay(); // 0 = dimanche
  return addDays(day, -((dow + 6) % 7));
};

// Singleton (survit au hot-reload en dev)
const g = globalThis as unknown as { __db?: Database.Database };
export const db: Database.Database = g.__db ?? (g.__db = open());

function open() {
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(`
  CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    activite TEXT DEFAULT '',
    telephone TEXT DEFAULT '',
    whatsapp TEXT DEFAULT '',
    tel_norm TEXT DEFAULT '',          -- 10 derniers chiffres, pour dédoublonner
    email TEXT DEFAULT '',
    site_web TEXT DEFAULT '',
    adresse TEXT DEFAULT '',
    colonia TEXT DEFAULT '',
    ville TEXT DEFAULT '',
    lat REAL, lng REAL,
    fiche_google TEXT DEFAULT '',      -- oui | non | vide | verifier | ''
    lien_google TEXT DEFAULT '',
    note_google REAL, nb_avis INTEGER,
    source TEXT DEFAULT 'manuel',      -- DENUE | manuel | Excel
    source_detail TEXT DEFAULT '',     -- nom du fichier Excel
    denue_id TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    interet TEXT DEFAULT '',           -- chaud | tiede | froid | ''
    statut TEXT NOT NULL DEFAULT 'a_contacter',
    statut_date TEXT,
    first_contact_at TEXT,
    next_followup TEXT,                -- date YYYY-MM-DD de la prochaine relance
    score INTEGER, score_raison TEXT DEFAULT '',   -- classement IA
    etiquette TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_b_statut ON businesses(statut);
  CREATE INDEX IF NOT EXISTS idx_b_tel ON businesses(tel_norm);
  CREATE INDEX IF NOT EXISTS idx_b_denue ON businesses(denue_id);

  CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    statut TEXT NOT NULL, at TEXT NOT NULL, day TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    type TEXT NOT NULL, content TEXT DEFAULT '', at TEXT NOT NULL, day TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_a_day ON actions(day, type);

  CREATE TABLE IF NOT EXISTS clients (
    business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    formule TEXT DEFAULT 'Base',
    prix_install REAL DEFAULT 0, prix_mensuel REAL DEFAULT 0,
    acompte_montant REAL DEFAULT 0, acompte_paye INTEGER DEFAULT 0, acompte_date TEXT,
    checklist TEXT DEFAULT '{}',
    parrain_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  -- month = 'base' (chiffres de départ) ou 'YYYY-MM'
  CREATE TABLE IF NOT EXISTS client_stats (
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    vues INTEGER, actions INTEGER, appels INTEGER, itineraires INTEGER, avis INTEGER,
    PRIMARY KEY (business_id, month)
  );

  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  -- Anti brute-force : échecs de connexion par IP (survit aux redémarrages)
  CREATE TABLE IF NOT EXISTS login_guard (
    ip TEXT PRIMARY KEY,
    fails INTEGER NOT NULL DEFAULT 0,          -- échecs depuis le dernier blocage
    strikes INTEGER NOT NULL DEFAULT 0,        -- nombre de blocages successifs (le délai double à chaque fois)
    blocked_until INTEGER NOT NULL DEFAULT 0,  -- epoch ms
    last_fail INTEGER NOT NULL DEFAULT 0       -- epoch ms
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,                -- user | assistant | tool
    content TEXT DEFAULT '',
    proposals TEXT,                    -- JSON : modifications proposées par l'IA (en attente / appliquées)
    created_at TEXT NOT NULL
  );
  `);
  migrate(d);
  return d;
}

/**
 * Migrations non destructives (ADD COLUMN / CREATE ... IF NOT EXISTS uniquement) : les fiches existantes restent intactes.
 * Exécutées à l'ouverture de la base, donc au démarrage du serveur (instrumentation.ts) ; idempotentes.
 */
function migrate(d: Database.Database) {
  const colsOf = (t: string) => new Set((d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
  const cols = colsOf("businesses");
  const add: [string, string][] = [
    ["niche", "TEXT DEFAULT ''"], ["offre", "TEXT DEFAULT ''"], ["presence_web", "TEXT DEFAULT ''"],
    ["angle", "TEXT DEFAULT ''"], ["zone", "TEXT DEFAULT ''"], ["message_whatsapp", "TEXT DEFAULT ''"],
    ["import_batch_id", "INTEGER"],
    // v3 : cycle de vie orienté action
    ["perdu_motif", "TEXT DEFAULT ''"],          // motif de « Perdu » (MOTIFS)
    ["no_whatsapp", "INTEGER DEFAULT 0"],        // 1 = numéro sans WhatsApp → liste « À appeler »
    ["relance_n", "INTEGER DEFAULT 0"],          // relances faites : 0 → J+2 due, 1 → J+7 due, 2 → fin (proposer Perdu)
    ["next_step", "TEXT DEFAULT ''"],            // Intéressé : prochaine étape
    ["next_date", "TEXT"],                       // à rappeler le / date de la prochaine étape (YYYY-MM-DD)
  ];
  const fromVersion = d.pragma("user_version", { simple: true }) as number;
  d.transaction(() => {
    for (const [c, def] of add) if (!cols.has(c)) d.exec(`ALTER TABLE businesses ADD COLUMN ${c} ${def}`);
    const aCols = colsOf("actions");
    if (!aCols.has("step")) d.exec("ALTER TABLE actions ADD COLUMN step TEXT DEFAULT ''");        // étape de la file : first | j2 | j7 | fin | reponse | rappel | etape
    if (!aCols.has("result")) d.exec("ALTER TABLE actions ADD COLUMN result TEXT DEFAULT ''");    // bouton de résultat utilisé
    if (!colsOf("status_history").has("motif")) d.exec("ALTER TABLE status_history ADD COLUMN motif TEXT DEFAULT ''");
    d.exec(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      added INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0,
      ignored INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      cancelled_at TEXT, cancelled_deleted INTEGER, cancelled_kept INTEGER
    );
    -- File du jour : figée pour la journée (positions stables), complétée en fin de bloc si besoin.
    CREATE TABLE IF NOT EXISTS daily_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      block TEXT NOT NULL,                       -- reponses | relances | nouveaux
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      done_at TEXT,
      UNIQUE(day, block, business_id)
    );
    CREATE TABLE IF NOT EXISTS queue_meta (day TEXT PRIMARY KEY, hash TEXT NOT NULL);
    -- « Annuler » (10 s) : état de la fiche avant l'action + lignes créées par l'action.
    CREATE TABLE IF NOT EXISTS undo_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      snapshot TEXT NOT NULL, action_ids TEXT NOT NULL, history_ids TEXT NOT NULL,
      queue_ids TEXT NOT NULL DEFAULT '[]', client_created INTEGER NOT NULL DEFAULT 0,
      at INTEGER NOT NULL, undone_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_b_niche ON businesses(niche);
    CREATE INDEX IF NOT EXISTS idx_b_zone ON businesses(zone);
    CREATE INDEX IF NOT EXISTS idx_b_offre ON businesses(offre);
    CREATE INDEX IF NOT EXISTS idx_b_presence ON businesses(presence_web);
    CREATE INDEX IF NOT EXISTS idx_b_ville ON businesses(ville COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_b_fiche ON businesses(fiche_google);
    CREATE INDEX IF NOT EXISTS idx_b_batch ON businesses(import_batch_id);
    CREATE INDEX IF NOT EXISTS idx_b_statut_offre ON businesses(statut, offre, nb_avis);
    CREATE INDEX IF NOT EXISTS idx_b_followup ON businesses(statut, next_followup);
    CREATE INDEX IF NOT EXISTS idx_b_next_date ON businesses(statut, next_date);
    CREATE INDEX IF NOT EXISTS idx_a_business ON actions(business_id);
    CREATE INDEX IF NOT EXISTS idx_h_business ON status_history(business_id);
    CREATE INDEX IF NOT EXISTS idx_h_day ON status_history(day, statut);
    CREATE INDEX IF NOT EXISTS idx_q_day ON daily_queue(day, block, position);
    CREATE INDEX IF NOT EXISTS idx_u_business ON undo_log(business_id);
    `);
    if (fromVersion < 3) migrateV3(d);
    if (fromVersion < SCHEMA_VERSION) d.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}

/**
 * v2 → v3 (une seule fois, dans la transaction de migrate) :
 * - « Pas intéressé » devient « Perdu » (motif Pas intéressé). L'historique des statuts n'est pas réécrit.
 * - Fiches « Contacté » : nombre de relances déjà faites déduit du journal ; une fiche sans relance programmée
 *   (les deux relances étaient passées) revient dans la file du jour pour qu'on décide de sa suite.
 * - WhatsApp déjà journalisés : étape (first / j2 / j7) renseignée pour les compteurs du jour.
 */
function migrateV3(d: Database.Database) {
  d.prepare("UPDATE businesses SET statut='perdu', perdu_motif='pas_interesse', next_followup=NULL WHERE statut='pas_interesse'").run();
  d.prepare(`UPDATE businesses SET relance_n = MIN(2, MAX(0, (SELECT COUNT(*) FROM actions a WHERE a.business_id = businesses.id
    AND a.type IN ('whatsapp','appel_pas_repondu')) - 1)) WHERE statut='contacte'`).run();
  d.prepare("UPDATE businesses SET next_followup=? WHERE statut='contacte' AND next_followup IS NULL").run(dayOf());
  d.prepare("UPDATE businesses SET next_followup=NULL WHERE statut NOT IN ('contacte')").run();
  for (const [content, step] of [["Premier message", "first"], ["Relance J+2", "j2"], ["Relance J+7", "j7"]])
    d.prepare("UPDATE actions SET step=? WHERE type='whatsapp' AND content=? AND (step IS NULL OR step='')").run(step, content);
}

