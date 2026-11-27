import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { TZ } from "./constants";
import { migrateV8, seedApiTerms } from "./niche-seed";

const file = path.resolve(process.env.DATABASE_PATH || "./data/crm.db");
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

/** Version du schéma (PRAGMA user_version), déclarée avant l'ouverture de la base (utilisée par migrate()). */
export const SCHEMA_VERSION = 11;

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
  d.pragma("busy_timeout = 10000");   // plusieurs processus (build, script de géocodage) : on attend le verrou
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
    // v4 : carte
    ["geo_precision", "TEXT DEFAULT ''"],        // commerce | adresse | zone | ville | '' (sans position)
    ["geo_source", "TEXT DEFAULT ''"],           // denue | import | nominatim | manuel | ''
    ["geo_date", "TEXT"],                        // date de la position (ISO)
    // v5 : contacts, « ne pas contacter », DENUE avancé
    ["facebook", "TEXT DEFAULT ''"],             // lien de la page Facebook
    ["instagram", "TEXT DEFAULT ''"],            // lien du compte Instagram
    ["wa_confirme", "INTEGER DEFAULT 0"],        // 1 = numéro avec WhatsApp confirmé (envoi réussi ou saisie) ; no_whatsapp=1 prime
    ["ne_pas_contacter", "INTEGER DEFAULT 0"],   // 1 = exclu des files, de la carte (par défaut) et des envois WhatsApp
    ["dnc_at", "TEXT"],                          // date du marquage « ne pas contacter »
    ["denue_num", "TEXT DEFAULT ''"],            // « Id » DENUE de l'établissement (méthode Ficha) ; denue_id = CLEE
    ["denue_alta", "TEXT DEFAULT ''"],           // Fecha_Alta DENUE (AAAA-MM)
    ["denue_estrato", "TEXT DEFAULT ''"],        // personnel occupé (« 0 a 5 personas »)
    ["denue_sync", "TEXT"],                      // dernière mise à jour depuis DENUE (ISO)
    // v6 : sources multiples, OSM / Overture, enrichissement, Google Places
    ["sources", "TEXT DEFAULT ''"],              // sources de la fiche, séparées par des virgules : excel,denue,osm,overture,manuel,google
    ["osm_id", "TEXT DEFAULT ''"],               // « node/123 », « way/456 » (OpenStreetMap)
    ["overture_id", "TEXT DEFAULT ''"],          // identifiant Overture Maps (GERS)
    ["tiktok", "TEXT DEFAULT ''"],               // lien du compte TikTok
    ["horaires", "TEXT DEFAULT ''"],             // opening_hours (OSM)
    ["enrich_status", "TEXT DEFAULT ''"],        // '' | trouve | rien | injoignable | bloque | robots
    ["enrich_at", "TEXT"],                       // date du dernier enrichissement (ISO)
    ["google_at", "TEXT"],                       // dernière vérification Google Places (ISO)
    ["google_place_id", "TEXT DEFAULT ''"],
    // v7 : tout le Mexique (État et municipio de la fiche, codes INEGI)
    ["etat", "TEXT DEFAULT ''"],                 // nom de l'entidad (« Quintana Roo »)
    ["etat_code", "TEXT DEFAULT ''"],            // 2 chiffres
    ["municipio", "TEXT DEFAULT ''"],            // nom du municipio
    ["municipio_code", "TEXT DEFAULT ''"],       // 3 chiffres
    // v8 : niches centrales (table niches) ; la colonne texte « niche » reste le libellé, synchronisé
    ["niche_id", "INTEGER"],
    // v9 : détail de l'activité (« Orthodontie », « Freins & suspension ») ; la niche reste la catégorie principale
    ["specialite", "TEXT DEFAULT ''"],
    // v10 : identifiants des sources API (Google : google_place_id existe déjà)
    ["foursquare_id", "TEXT DEFAULT ''"],
    ["here_id", "TEXT DEFAULT ''"],
    ["tomtom_id", "TEXT DEFAULT ''"],
  ];
  // BEGIN IMMEDIATE : un seul processus migre à la fois ; les colonnes et la version sont relues sous le verrou.
  d.transaction(() => {
    const fromVersion = d.pragma("user_version", { simple: true }) as number;
    const cols = colsOf("businesses");
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
    -- v4 : file de géocodage persistante (reprend après redémarrage) et cache des réponses Nominatim.
    CREATE TABLE IF NOT EXISTS geo_queue (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,       -- échecs réseau / serveur (abandon après 5)
      next_try_at INTEGER NOT NULL DEFAULT 0,    -- epoch ms
      done_at TEXT,                              -- traité (gardé pour la progression « 340 / 1000 » du lot en cours)
      result TEXT DEFAULT ''                     -- commerce | adresse | zone | ville | aucun | erreur | ignore
    );
    CREATE INDEX IF NOT EXISTS idx_gq_pending ON geo_queue(done_at, next_try_at);
    CREATE TABLE IF NOT EXISTS geo_cache (
      q TEXT PRIMARY KEY,                        -- requête normalisée
      results TEXT NOT NULL DEFAULT '[]',        -- candidats situés dans le Quintana Roo (JSON) ; [] = aucun
      rejected INTEGER NOT NULL DEFAULT 0,       -- candidats écartés (hors Quintana Roo)
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_b_latlng ON businesses(lat, lng);
    CREATE INDEX IF NOT EXISTS idx_b_statut_geo ON businesses(statut, lat);
    `);
    if (fromVersion < 3) migrateV3(d);
    d.exec(`
    -- v5 : cache des réponses DENUE (24 h), recherches enregistrées + veille, vues enregistrées de Commerces.
    CREATE TABLE IF NOT EXISTS denue_cache (
      k TEXT PRIMARY KEY,                        -- chemin de la requête, sans le token
      body TEXT NOT NULL,                        -- réponse JSON (tableau)
      at INTEGER NOT NULL                        -- epoch ms
    );
    CREATE TABLE IF NOT EXISTS denue_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      params TEXT NOT NULL,                      -- JSON (lib/denue-run.ts : SearchParams)
      watch INTEGER NOT NULL DEFAULT 0,          -- 1 = relancée chaque semaine
      created_at TEXT NOT NULL,
      last_run_at TEXT, last_total INTEGER, last_error TEXT DEFAULT ''
    );
    -- CLEE déjà vus par une recherche enregistrée ; is_new = 1 : apparu lors d'une veille, à valider (row = fiche DENUE).
    CREATE TABLE IF NOT EXISTS denue_seen (
      search_id INTEGER NOT NULL REFERENCES denue_searches(id) ON DELETE CASCADE,
      clee TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      is_new INTEGER NOT NULL DEFAULT 0,
      row TEXT,
      PRIMARY KEY (search_id, clee)
    );
    CREATE INDEX IF NOT EXISTS idx_ds_new ON denue_seen(is_new, search_id);
    CREATE TABLE IF NOT EXISTS saved_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      query TEXT NOT NULL,                       -- paramètres d'URL de /commerces
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_b_dnc ON businesses(ne_pas_contacter);
    CREATE INDEX IF NOT EXISTS idx_b_source ON businesses(source);
    CREATE INDEX IF NOT EXISTS idx_b_email ON businesses(email);
    `);
    d.exec(`
    -- v6 : origine de chaque information remplie automatiquement (source, enrichissement, Google)
    CREATE TABLE IF NOT EXISTS field_origins (
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      field TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL,                      -- ex. « email trouvé sur sitio.com/contacto »
      at TEXT NOT NULL,
      PRIMARY KEY (business_id, field)
    );
    -- Correspondance catégorie d'une source → niche du CRM (surcharge des règles par défaut, Réglages)
    CREATE TABLE IF NOT EXISTS category_map (
      source TEXT NOT NULL,                      -- osm | overture
      category TEXT NOT NULL,                    -- « shop=beauty », « nail_salon »
      niche TEXT NOT NULL DEFAULT '',            -- '' = ignorée (aucune niche)
      PRIMARY KEY (source, category)
    );
    -- Cache des réponses HTTP externes (Overpass, robots.txt) : clé = source + requête
    CREATE TABLE IF NOT EXISTS http_cache (k TEXT PRIMARY KEY, body TEXT NOT NULL, at INTEGER NOT NULL);
    -- File d'enrichissement (même modèle que geo_queue : persistante, reprise après redémarrage)
    CREATE TABLE IF NOT EXISTS enrich_queue (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_try_at INTEGER NOT NULL DEFAULT 0,
      done_at TEXT,
      result TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_eq_pending ON enrich_queue(done_at, next_try_at);
    -- Lieux Overture Maps (bbox Quintana Roo), rechargés par scripts/overture-sync.sh
    CREATE TABLE IF NOT EXISTS overture_places (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',         -- taxonomy.primary
      basic_category TEXT NOT NULL DEFAULT '',
      categories TEXT NOT NULL DEFAULT '',       -- hiérarchie + alternatives, séparées par des virgules
      phones TEXT NOT NULL DEFAULT '[]', websites TEXT NOT NULL DEFAULT '[]', socials TEXT NOT NULL DEFAULT '[]', emails TEXT NOT NULL DEFAULT '[]',
      address TEXT NOT NULL DEFAULT '', locality TEXT NOT NULL DEFAULT '', postcode TEXT NOT NULL DEFAULT '',
      confidence REAL, operating_status TEXT NOT NULL DEFAULT '',
      lat REAL, lng REAL,
      release TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_op_cat ON overture_places(category);
    CREATE INDEX IF NOT EXISTS idx_op_basic ON overture_places(basic_category);
    CREATE INDEX IF NOT EXISTS idx_op_ll ON overture_places(lat, lng);
    CREATE TABLE IF NOT EXISTS overture_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS google_usage (month TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_b_osm ON businesses(osm_id);
    CREATE INDEX IF NOT EXISTS idx_b_overture ON businesses(overture_id);
    `);
    if (fromVersion < 4) migrateV4(d);
    if (fromVersion < 5) migrateV5(d);
    d.exec(`
    -- v7 : localidades d'un municipio (rurales comprises) demandées au service INEGI, gardées 30 jours
    CREATE TABLE IF NOT EXISTS geo_localidades (k TEXT PRIMARY KEY, body TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_b_etat ON businesses(etat_code, municipio_code);
    `);
    if (fromVersion < 6) migrateV6(d);
    if (fromVersion < 7) migrateV7(d);
    if (!colsOf("daily_queue").has("picked")) d.exec("ALTER TABLE daily_queue ADD COLUMN picked INTEGER NOT NULL DEFAULT 0");   // ajoutée à la main (« Ajouter à ma journée »)
    d.exec(`
    -- v8 : niches (nom, couleur, icône) et leurs correspondances (SCIAN, OSM, Overture, mots-clés Excel)
    CREATE TABLE IF NOT EXISTS niches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE COLLATE NOCASE,
      color TEXT NOT NULL DEFAULT '#94a3b8',
      icon TEXT NOT NULL DEFAULT 'tag',
      description TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    -- kind : scian | osm | overture | keyword ; value préfixée de « ! » = exclusion (osm / overture)
    CREATE TABLE IF NOT EXISTS niche_maps (
      niche_id INTEGER NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (niche_id, kind, value)
    );
    CREATE INDEX IF NOT EXISTS idx_nm_kind ON niche_maps(kind, value);
    CREATE INDEX IF NOT EXISTS idx_b_niche_id ON businesses(niche_id, statut);
    -- Filtres « Ma journée » (Aujourd'hui) : remplacent le filtre par défaut de la file pour ce jour seulement
    CREATE TABLE IF NOT EXISTS day_filters (day TEXT PRIMARY KEY, filter TEXT NOT NULL, relances INTEGER NOT NULL DEFAULT 0);
    -- Texte de niche écrit sans niche_id (anciennes routes, IA, import) : niche_id retrouvé par le libellé
    CREATE TRIGGER IF NOT EXISTS trg_b_niche_ins AFTER INSERT ON businesses
      WHEN NEW.niche_id IS NULL AND COALESCE(NEW.niche, '') != ''
      BEGIN UPDATE businesses SET niche_id = (SELECT id FROM niches WHERE label = NEW.niche COLLATE NOCASE) WHERE id = NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS trg_b_niche_upd AFTER UPDATE OF niche ON businesses
      WHEN NEW.niche IS NOT OLD.niche AND NEW.niche_id IS OLD.niche_id
      BEGIN UPDATE businesses SET niche_id = (SELECT id FROM niches WHERE label = NEW.niche COLLATE NOCASE) WHERE id = NEW.id; END;
    `);
    if (fromVersion < 8 || (d.prepare("SELECT COUNT(*) n FROM niches").get() as { n: number }).n === 0) migrateV8(d);
    d.exec(`
    -- v10 : appels aux API de lieux par mois (plafond mensuel réglable : bloque avant de dépasser l'offre gratuite)
    CREATE TABLE IF NOT EXISTS api_usage (provider TEXT NOT NULL, month TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (provider, month));
    CREATE INDEX IF NOT EXISTS idx_b_fsq ON businesses(foursquare_id);
    CREATE INDEX IF NOT EXISTS idx_b_here ON businesses(here_id);
    CREATE INDEX IF NOT EXISTS idx_b_tomtom ON businesses(tomtom_id);
    CREATE INDEX IF NOT EXISTS idx_b_gplace ON businesses(google_place_id);
    -- v10 : analyse de présence web (déterministe, sans IA) et texte du site pour l'IA
    CREATE TABLE IF NOT EXISTS web_audits (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '', final_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ok',         -- ok | injoignable | bloque | robots
      score INTEGER,                             -- 0-100 (NULL si le site n'a pas pu être lu)
      data TEXT NOT NULL DEFAULT '{}',           -- JSON : https, ms, viewport, titre, description, contacts, formulaire, réseaux…
      issues TEXT NOT NULL DEFAULT '[]'          -- JSON : points « à améliorer »
    );
    CREATE INDEX IF NOT EXISTS idx_wa_score ON web_audits(score);
    CREATE TABLE IF NOT EXISTS site_texts (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      at TEXT NOT NULL, pages TEXT NOT NULL DEFAULT '[]', text TEXT NOT NULL DEFAULT ''   -- texte nettoyé, ≤ 20 Ko
    );
    CREATE TABLE IF NOT EXISTS webaudit_queue (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_try_at INTEGER NOT NULL DEFAULT 0, done_at TEXT, result TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_wq_pending ON webaudit_queue(done_at, next_try_at);
    -- v10 : sorties de l'IA (propositions à valider, jamais appliquées seules) et file de traitement IA (en pause)
    CREATE TABLE IF NOT EXISTS ai_outputs (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'a_faire',    -- a_faire | en_cours | fait | erreur
      draft_message TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', improvements TEXT NOT NULL DEFAULT '[]',
      priority INTEGER, reason TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
      at TEXT, used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ai_queue (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL, task TEXT NOT NULL DEFAULT 'preparer', done_at TEXT, result TEXT DEFAULT ''
    );
    `);
    if (fromVersion < 10) migrateV10(d);
    // v11 : file IA active (essais, régénération forcée, origine) et journal des appels IA (sans contenu ni secret)
    const qCols = colsOf("ai_queue");
    for (const [c, def] of [["attempts", "INTEGER NOT NULL DEFAULT 0"], ["next_try_at", "INTEGER NOT NULL DEFAULT 0"], ["regen", "INTEGER NOT NULL DEFAULT 0"], ["origin", "TEXT NOT NULL DEFAULT 'manuel'"]])
      if (!qCols.has(c)) d.exec(`ALTER TABLE ai_queue ADD COLUMN ${c} ${def}`);
    d.exec(`
    CREATE INDEX IF NOT EXISTS idx_aiq_pending ON ai_queue(done_at, next_try_at);
    CREATE TABLE IF NOT EXISTS ai_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL, task TEXT NOT NULL, business_id INTEGER, provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
      ms INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER, completion_tokens INTEGER, error TEXT NOT NULL DEFAULT ''
    );
    `);
    d.exec(`
    -- v9 : regroupement des niches (page Niches > Regrouper) : état avant regroupement, pour « Annuler »
    CREATE TABLE IF NOT EXISTS niche_regroups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      snapshot TEXT NOT NULL,                    -- JSON : niches, correspondances, filtres de file avant le regroupement
      summary TEXT NOT NULL DEFAULT '{}',        -- JSON : niches fusionnées, fiches déplacées, sans niche
      ops_seq INTEGER NOT NULL DEFAULT 0,        -- n° d'opération de niches juste après ; annulable tant qu'il n'a pas bougé
      backup TEXT NOT NULL DEFAULT '',           -- fichier de sauvegarde fait juste avant
      undone_at TEXT
    );
    -- Niche d'origine de chaque fiche déplacée par un regroupement
    CREATE TABLE IF NOT EXISTS niche_regroup_items (
      regroup_id INTEGER NOT NULL REFERENCES niche_regroups(id) ON DELETE CASCADE,
      business_id INTEGER NOT NULL,
      old_niche_id INTEGER, old_niche TEXT NOT NULL DEFAULT '', old_specialite TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (regroup_id, business_id)
    );
    `);
    if (fromVersion < SCHEMA_VERSION) d.pragma(`user_version = ${SCHEMA_VERSION}`);
  }).immediate();
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


/**
 * v3 → v4 (une seule fois) : les fiches qui ont déjà une position la gardent, avec sa source
 * (DENUE → denue, import Excel → import, saisie dans la fiche → manuel) et la précision « commerce ».
 */
function migrateV4(d: Database.Database) {
  d.prepare(`UPDATE businesses SET geo_precision='commerce',
      geo_source = CASE source WHEN 'DENUE' THEN 'denue' WHEN 'Excel' THEN 'import' ELSE 'manuel' END,
      geo_date = COALESCE(geo_date, created_at)
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND COALESCE(geo_source,'') = ''`).run();
}

/**
 * v4 → v5 (une seule fois) : WhatsApp « oui » pour les numéros auxquels un WhatsApp a déjà été envoyé
 * (et pas marqués « sans WhatsApp »). Les autres restent « inconnu » ; aucune autre fiche n'est modifiée.
 */
function migrateV5(d: Database.Database) {
  d.prepare(`UPDATE businesses SET wa_confirme = 1 WHERE no_whatsapp = 0
    AND EXISTS (SELECT 1 FROM actions a WHERE a.business_id = businesses.id AND a.type = 'whatsapp')`).run();
}

/** v5 → v6 (une seule fois) : liste des sources de chaque fiche, déduite de la source d'origine. */
function migrateV6(d: Database.Database) {
  d.prepare(`UPDATE businesses SET sources = CASE source WHEN 'DENUE' THEN 'denue' WHEN 'Excel' THEN 'excel' ELSE 'manuel' END
    WHERE COALESCE(sources, '') = ''`).run();
}

/**
 * v6 → v7 (une seule fois) : le CRM ne contenait que des prospects du Quintana Roo → État = Quintana Roo (23).
 * Le municipio est complété au démarrage (lib/geo-backfill.ts : CLEE DENUE, position ou ville, catalogue INEGI).
 */
function migrateV7(d: Database.Database) {
  d.prepare("UPDATE businesses SET etat = 'Quintana Roo', etat_code = '23' WHERE COALESCE(etat_code, '') = ''").run();
}

/**
 * v9 → v10 (une seule fois) : compteur Google existant repris dans api_usage ; termes de recherche des API de lieux
 * ajoutés aux niches principales existantes (même nom), modifiables dans la page Niches.
 */
function migrateV10(d: Database.Database) {
  if (d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='google_usage'").get())
    d.exec("INSERT OR IGNORE INTO api_usage(provider, month, n) SELECT 'google', month, n FROM google_usage");
  seedApiTerms(d);
}
