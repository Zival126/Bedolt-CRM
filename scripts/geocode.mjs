// Géocodage des fiches sans position (le travail est fait par le serveur du CRM, 1 requête/seconde vers Nominatim) :
// ce script ne contacte PAS Nominatim, il remplit la file persistante (table geo_queue) que le worker du serveur
// relit toutes les 30 s, puis affiche la progression.
//   node scripts/geocode.mjs --status     progression du lot en cours + fiches sans position
//   node scripts/geocode.mjs --enqueue    ajoute toutes les fiches sans position (sauf positions manuelles / DENUE / import)
//   node scripts/geocode.mjs --watch      affiche la progression toutes les 10 s jusqu'à la fin (Ctrl+C pour quitter)
// Sur le VPS : cd /var/www/bedolt-crm && runuser -u bedoltcrm -- node scripts/geocode.mjs --enqueue
// Même effet que le bouton « Géolocaliser les fiches sans position » de la page Carte.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(DATABASE_PATH)\s*=\s*(.*?)\s*$/);
    if (m && process.env.DATABASE_PATH === undefined) process.env.DATABASE_PATH = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {}
const file = path.resolve(root, process.env.DATABASE_PATH || "data/crm.db");
if (!fs.existsSync(file)) { console.error("Base introuvable :", file); process.exit(1); }
const db = new Database(file);
db.pragma("busy_timeout = 5000");
const v = db.pragma("user_version", { simple: true });
if (v < 4) { console.error(`Schéma v${v} : démarre d'abord le CRM mis à jour (migration v4), puis relance.`); process.exit(1); }

function status() {
  const q = db.prepare(`SELECT COUNT(*) total, COUNT(done_at) done,
    SUM(CASE WHEN result IN ('commerce','adresse','zone','ville') THEN 1 ELSE 0 END) located,
    SUM(CASE WHEN result IN ('aucun','erreur') THEN 1 ELSE 0 END) failed FROM geo_queue`).get();
  const missing = db.prepare("SELECT COUNT(*) n FROM businesses WHERE lat IS NULL").get().n;
  const by = db.prepare("SELECT COALESCE(NULLIF(geo_precision,''),'sans position') p, COUNT(*) n FROM businesses GROUP BY 1 ORDER BY n DESC").all();
  return { ...q, missing, by };
}
const show = (s) => console.log(`Lot en cours : ${s.done} / ${s.total} traitées (${s.located ?? 0} placées, ${s.failed ?? 0} introuvables) · ` +
  `${s.missing} fiche(s) sans position · précisions : ${s.by.map((x) => `${x.p} ${x.n}`).join(", ")}`);

const arg = process.argv[2] ?? "--status";
if (arg === "--enqueue") {
  const t = new Date().toISOString();
  const n = db.transaction(() => {
    const pending = db.prepare("SELECT COUNT(*) n FROM geo_queue WHERE done_at IS NULL").get().n;
    if (!pending) db.prepare("DELETE FROM geo_queue WHERE done_at IS NOT NULL").run();
    return db.prepare(`INSERT INTO geo_queue(business_id, added_at) SELECT id, ? FROM businesses
      WHERE lat IS NULL AND COALESCE(geo_source,'') IN ('','nominatim')
      ON CONFLICT(business_id) DO UPDATE SET done_at=NULL, result='', attempts=0, next_try_at=0, added_at=excluded.added_at
      WHERE geo_queue.done_at IS NOT NULL`).run(t).changes;
  })();
  console.log(`${n} fiche(s) ajoutée(s) à la file. Le serveur les traite à 1 requête/seconde (prise en compte sous 30 s).`);
  show(status());
} else if (arg === "--watch") {
  const tick = () => { const s = status(); show(s); if (s.total && s.done >= s.total) process.exit(0); };
  tick(); setInterval(tick, 10_000);
} else if (arg === "--status") {
  show(status());
} else {
  console.error("Usage : node scripts/geocode.mjs [--status | --enqueue | --watch]"); process.exit(1);
}
