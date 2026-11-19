// Remet à zéro les blocages de connexion (table login_guard). Sans outil supplémentaire (better-sqlite3 du CRM).
//   node scripts/reset-login-guard.mjs              → liste puis supprime TOUS les blocages
//   node scripts/reset-login-guard.mjs 203.0.113.7  → uniquement cette IP
// Sur le VPS : runuser -u bedoltcrm -- node /var/www/bedolt-crm/scripts/reset-login-guard.mjs
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
const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='login_guard'").get();
if (!hasTable) { console.log("Aucune table login_guard : rien à débloquer."); process.exit(0); }
const ip = process.argv[2];
const rows = db.prepare(`SELECT ip, fails, strikes, blocked_until FROM login_guard ${ip ? "WHERE ip = ?" : ""}`).all(...(ip ? [ip] : []));
for (const r of rows) {
  const left = r.blocked_until > Date.now() ? `bloquée encore ${Math.ceil((r.blocked_until - Date.now()) / 60000)} min` : "non bloquée";
  console.log(`- ${r.ip} : ${r.fails} échec(s) en cours, ${r.strikes} blocage(s), ${left}`);
}
const n = db.prepare(`DELETE FROM login_guard ${ip ? "WHERE ip = ?" : ""}`).run(...(ip ? [ip] : [])).changes;
db.close();
console.log(n ? `${n} entrée(s) supprimée(s) : connexion de nouveau possible.` : "Aucun blocage enregistré" + (ip ? ` pour ${ip}.` : "."));
