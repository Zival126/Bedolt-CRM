// Sauvegarde quotidienne de la base SQLite : copie datée dans backups/, 30 jours conservés.
// Usage : node scripts/backup.mjs   (voir README pour le cron)
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile(path.join(root, ".env")); } catch {} // lit DATABASE_PATH depuis .env (Node >= 21.7)
const src = path.resolve(root, process.env.DATABASE_PATH || "data/crm.db");
const dir = path.join(root, "backups");
fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(src)) { console.error("Base introuvable :", src); process.exit(1); }

const stamp = new Date().toISOString().slice(0, 10);
const dest = path.join(dir, `crm-${stamp}.db`);
const db = new Database(src, { readonly: true });
await db.backup(dest); // copie cohérente même si l'app écrit en même temps
db.close();
console.log("Sauvegarde :", dest);

const KEEP = 30;
const files = fs.readdirSync(dir).filter((f) => /^crm-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.unlinkSync(path.join(dir, f));
