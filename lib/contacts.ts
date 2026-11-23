// Champs de contact (sans accès à la base : utilisable côté client et serveur).
import { safeHttpUrl } from "./phone";

const HOSTS = { facebook: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i, instagram: /(^|\.)(instagram\.com|instagr\.am)$/i };

/** « @monsalon » ou « monsalon » → https://www.instagram.com/monsalon ; lien complet gardé s'il pointe vers le bon site. */
export function normalizeSocial(kind: "facebook" | "instagram", raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const handle = v.replace(/^@/, "");
  if (/^[\w.]{1,80}$/.test(handle)) return `https://www.${kind}.com/${handle}`;
  const url = safeHttpUrl(/^https?:\/\//i.test(v) ? v : "https://" + v);
  if (!url) return v; // refusé par la validation (lien affiché tel quel, jamais en href)
  try { return HOSTS[kind].test(new URL(url).hostname) ? url : v; } catch { return v; }
}
/** Lien cliquable sûr (http/https et domaine attendu), sinon ''. */
export function socialHref(kind: "facebook" | "instagram", v: string): string {
  const u = safeHttpUrl(v);
  if (!u) return "";
  try { return HOSTS[kind].test(new URL(u).hostname) ? u : ""; } catch { return ""; }
}
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test((s ?? "").trim());
export const mailto = (email: string, subject = "") => (isEmail(email) ? `mailto:${email.trim()}${subject ? "?subject=" + encodeURIComponent(subject) : ""}` : "");
