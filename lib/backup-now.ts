// Sauvegarde immédiate de la base (avant une opération risquée : regroupement des niches).
// Copie cohérente via l'API de sauvegarde SQLite ; fichier en 600 dans backups/ (BACKUP_DIR pour un autre dossier).
import fs from "node:fs";
import path from "node:path";
import { db } from "./db";

export async function backupNow(tag: string, keep = 5): Promise<string> {
  const dir = path.resolve(process.env.BACKUP_DIR || "backups");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const iso = new Date().toISOString();
  const t = tag.replace(/[^a-z0-9-]/gi, "");
  const file = path.join(dir, `crm-${iso.slice(0, 10)}-${t}-${iso.slice(11, 19).replace(/:/g, "")}.db`);
  await db.backup(file);
  fs.chmodSync(file, 0o600);
  // On ne garde que les `keep` dernières sauvegardes de ce type
  const old = fs.readdirSync(dir).filter((f) => f.startsWith("crm-") && f.includes(`-${t}-`) && f.endsWith(".db")).sort();
  for (const f of old.slice(0, Math.max(0, old.length - keep))) fs.rmSync(path.join(dir, f), { force: true });
  return path.basename(file);
}
