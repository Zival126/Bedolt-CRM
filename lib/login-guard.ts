// Anti brute-force PAR IP, persistant (SQLite) : 5 échecs → blocage 15 min, puis 30, 60… (plafond 24 h).
// Les compteurs d'une IP sont oubliés après 24 h sans échec.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db";

const MAX_FAILS = 5;
const BASE_BLOCK_MS = 15 * 60_000;
const MAX_BLOCK_MS = 24 * 60 * 60_000;
const FORGET_MS = 24 * 60 * 60_000;

type Row = { ip: string; fails: number; strikes: number; blocked_until: number; last_fail: number };
const get = (ip: string) => db.prepare("SELECT * FROM login_guard WHERE ip=?").get(ip) as Row | undefined;

/** Millisecondes restantes de blocage (0 = autorisé). */
export function blockedFor(ip: string, now = Date.now()): number {
  const r = get(ip);
  return r && r.blocked_until > now ? r.blocked_until - now : 0;
}

/** Enregistre un échec ; renvoie la durée de blocage déclenchée (0 si pas encore bloqué). */
export function recordFailure(ip: string, now = Date.now()): number {
  let r = get(ip) ?? { ip, fails: 0, strikes: 0, blocked_until: 0, last_fail: 0 };
  if (now - r.last_fail > FORGET_MS) r = { ...r, fails: 0, strikes: 0 };
  r.fails++;
  r.last_fail = now;
  let block = 0;
  if (r.fails >= MAX_FAILS) {
    r.strikes++;
    block = Math.min(BASE_BLOCK_MS * 2 ** (r.strikes - 1), MAX_BLOCK_MS);
    r.blocked_until = now + block;
    r.fails = 0;
  }
  db.prepare(`INSERT INTO login_guard(ip,fails,strikes,blocked_until,last_fail) VALUES(@ip,@fails,@strikes,@blocked_until,@last_fail)
    ON CONFLICT(ip) DO UPDATE SET fails=@fails, strikes=@strikes, blocked_until=@blocked_until, last_fail=@last_fail`).run(r);
  db.prepare("DELETE FROM login_guard WHERE last_fail < ? AND blocked_until < ?").run(now - 7 * FORGET_MS, now);
  return block;
}

export function recordSuccess(ip: string) {
  db.prepare("DELETE FROM login_guard WHERE ip=?").run(ip);
}

/** Comparaison à temps constant : SHA-256 des deux valeurs, puis timingSafeEqual (longueurs toujours égales). */
export function passwordMatches(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b) && expected.length > 0;
}

// ---------- Journal pour fail2ban ----------
// Format (UTC) : « 2026-11-18 23:04:05 bedolt-crm login-failed ip=203.0.113.7 »
const LOG = path.resolve(process.env.AUTH_LOG_PATH || "./logs/auth.log");
export function authLog(event: "login-failed" | "login-blocked" | "login-ok", ip: string) {
  const line = `${new Date().toISOString().replace("T", " ").slice(0, 19)} bedolt-crm ${event} ip=${ip}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true, mode: 0o700 });
    fs.appendFileSync(LOG, line, { mode: 0o600 });
  } catch (e) {
    console.error("[bedolt-crm] journal d'authentification impossible :", (e as Error).message);
  }
  if (event !== "login-ok") console.warn("[bedolt-crm]", line.trim());
}
