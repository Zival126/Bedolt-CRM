// Sauvegarde de la base SQLite : copie cohérente dans backups/ (fichiers en 600, dossier en 700).
//
//   node scripts/backup.mjs                 sauvegarde quotidienne  backups/crm-AAAA-MM-JJ.db (30 conservées)
//   node scripts/backup.mjs --tag predeploy sauvegarde ponctuelle   backups/crm-AAAA-MM-JJ-predeploy-HHMMSS.db (10 conservées)
//
// Copie hors VPS OPTIONNELLE (seulement pour la sauvegarde quotidienne) si BACKUP_REMOTE est défini dans .env :
// chiffrement local (age si BACKUP_AGE_RECIPIENT, sinon gpg symétrique si BACKUP_GPG_PASSPHRASE), puis
// `rclone copyto` vers BACKUP_REMOTE. Jamais d'envoi en clair : sans clé, l'envoi est refusé.
// Code de sortie : 0 OK · 1 sauvegarde locale impossible · 2 sauvegarde locale OK mais envoi distant en échec.
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.umask(0o077);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Lecture de .env (DATABASE_PATH, BACKUP_*) sans dépendance ; les variables déjà définies priment.
try {
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {}
const log = (...a) => console.log(new Date().toISOString(), ...a);
const fail = (code, ...a) => { console.error(new Date().toISOString(), "ERREUR", ...a); process.exit(code); };

const tagArg = process.argv.indexOf("--tag");
const tag = tagArg > 0 ? String(process.argv[tagArg + 1] ?? "").replace(/[^a-z0-9-]/gi, "") : "";
const src = path.resolve(root, process.env.DATABASE_PATH || "data/crm.db");
const dir = path.join(root, "backups");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.chmodSync(dir, 0o700);
if (!fs.existsSync(src)) fail(1, "Base introuvable :", src);

const iso = new Date().toISOString();
const name = tag ? `crm-${iso.slice(0, 10)}-${tag}-${iso.slice(11, 19).replace(/:/g, "")}.db` : `crm-${iso.slice(0, 10)}.db`;
const dest = path.join(dir, name);
try {
  const db = new Database(src, { readonly: true, fileMustExist: true });
  await db.backup(dest); // copie cohérente même si l'application écrit en même temps
  db.close();
  fs.chmodSync(dest, 0o600);
} catch (e) { fail(1, "Sauvegarde impossible :", e.message); }
log("Sauvegarde :", dest);

// Rétention locale
const keep = (re, n) => {
  const files = fs.readdirSync(dir).filter((f) => re.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - n))) fs.unlinkSync(path.join(dir, f));
};
keep(/^crm-\d{4}-\d{2}-\d{2}\.db$/, 30);
keep(/^crm-\d{4}-\d{2}-\d{2}-[a-z0-9-]+-\d{6}\.db$/i, 10);

// ---------- Copie hors VPS (optionnelle) ----------
const remote = (process.env.BACKUP_REMOTE ?? "").trim();
if (!remote || tag) process.exit(0);

const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: "utf8", timeout: 15 * 60_000 });
  if (r.error) return `${cmd} introuvable ou en échec (${r.error.message})`;
  return r.status === 0 ? null : `${cmd} : code ${r.status} ${String(r.stderr ?? "").trim().slice(0, 300)}`;
};
const recipient = (process.env.BACKUP_AGE_RECIPIENT ?? "").trim();
const pass = process.env.BACKUP_GPG_PASSPHRASE ?? "";
let enc, err;
if (recipient) {
  enc = dest + ".age";
  err = run("age", ["-r", recipient, "-o", enc, dest]);
} else if (pass) {
  enc = dest + ".gpg";
  err = run("gpg", ["--batch", "--yes", "--quiet", "--pinentry-mode", "loopback", "--passphrase-fd", "0",
    "--symmetric", "--cipher-algo", "AES256", "-o", enc, dest], pass + "\n");
} else {
  fail(2, "BACKUP_REMOTE est défini mais aucune clé de chiffrement (BACKUP_AGE_RECIPIENT ou BACKUP_GPG_PASSPHRASE) : envoi refusé.");
}
if (err) { try { fs.unlinkSync(enc); } catch {} fail(2, "Chiffrement :", err); }

const target = remote.replace(/\/+$/, "") + "/" + path.basename(enc);
err = run("rclone", ["copyto", enc, target]);
fs.unlinkSync(enc); // la copie chiffrée locale n'est pas conservée
if (err) fail(2, "Envoi rclone :", err);
log("Copie chiffrée envoyée :", target);

const days = Number(process.env.BACKUP_REMOTE_KEEP_DAYS) || 30;
err = run("rclone", ["delete", remote, "--min-age", `${days}d`, "--include", "crm-*.db.*"]);
if (err) log("Avertissement : nettoyage distant impossible :", err);
