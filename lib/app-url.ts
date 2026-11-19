// URL publique du CRM (APP_URL, ex. https://crm.bedolt.com) : seule source des redirections absolues.
// Ne jamais reconstruire une URL depuis request.url ou l'en-tête Host : derrière OpenLiteSpeed, Next voit
// 127.0.0.1:3100 (d'où des redirections vers https://localhost:3100). Compatible Edge (middleware) et Node.
import { NextResponse } from "next/server";

/** APP_URL validée et sans « / » final, ou null si absente / invalide. */
export function appUrl(): string | null {
  const raw = (process.env.APP_URL ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.pathname !== "/" || u.search || u.hash) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Réponse de redirection vers `path` (chemin absolu « /… ») : APP_URL + path, sinon chemin relatif. */
export function redirectTo(path: string, status: 303 | 307 = 307): NextResponse {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("redirectTo : chemin local attendu");
  const base = appUrl();
  return new NextResponse(null, { status, headers: { Location: base ? base + path : path } });
}
