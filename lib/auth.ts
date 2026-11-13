// Session par cookie signé (HMAC-SHA256). Compatible Edge (middleware) et Node : Web Crypto uniquement.
export const COOKIE = "bedolt_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 jours

function secret() {
  return process.env.SESSION_SECRET || "bedolt-crm::" + (process.env.CRM_PASSWORD ?? "");
}
async function sign(data: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function makeToken() {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  return `${exp}.${await sign(exp)}`;
}
export async function verifyToken(token?: string) {
  if (!token || !process.env.CRM_PASSWORD) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = await sign(exp);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
  path: "/",
  maxAge: MAX_AGE,
};
