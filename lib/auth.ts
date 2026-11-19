// Jeton de session signé (HMAC-SHA256). Compatible Edge (middleware) et Node : Web Crypto uniquement.
//
// Format du cookie : <expiration>.<session_version>.<signature>
// La signature couvre aussi une empreinte de CRM_PASSWORD : changer le mot de passe invalide tous les cookies.
// La session_version (stockée en base) est comparée côté Node par requireSession() (lib/session.ts) :
// « Déconnecter toutes les sessions » l'incrémente, ce qui révoque tous les cookies existants.
export const COOKIE = "bedolt_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 jours
const enc = new TextEncoder();

/** SESSION_SECRET est obligatoire en production (vérifié aussi au démarrage, cf. instrumentation.ts). */
export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET ?? "";
  if (s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET manquant ou trop court (32 caractères minimum).");
  return "dev-only-insecure-secret-change-me-0123456789"; // développement local uniquement
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

async function passwordFingerprint() {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode("bedolt-pw::" + (process.env.CRM_PASSWORD ?? ""))));
}

async function sign(data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(sessionSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
const payload = async (exp: string, ver: string) => `v2|${exp}|${ver}|${await passwordFingerprint()}`;

export async function makeToken(version: number) {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  const ver = String(version);
  return `${exp}.${ver}.${await sign(await payload(exp, ver))}`;
}

/** Vérifie signature + expiration. Renvoie la version de session contenue dans le cookie, ou null. */
export async function verifyToken(token?: string): Promise<{ version: number } | null> {
  try {
    if (!token || !process.env.CRM_PASSWORD) return null;
    const [exp, ver, sig, extra] = token.split(".");
    if (!exp || !ver || !sig || extra !== undefined) return null;
    if (!/^\d+$/.test(exp) || !/^\d+$/.test(ver) || Number(exp) < Date.now() / 1000) return null;
    const expected = await sign(await payload(exp, ver));
    if (expected.length !== sig.length) return null;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0 ? { version: Number(ver) } : null;
  } catch {
    return null; // ex. SESSION_SECRET absent en production
  }
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
  path: "/",
  maxAge: MAX_AGE,
};
