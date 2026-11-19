// Vérification de session côté Node (routes API, server actions, pages), en plus du middleware.
// Le middleware (Edge) ne peut vérifier que la signature ; ici on compare aussi la session_version en base.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, verifyToken } from "./auth";
import { appUrl } from "./app-url";
import { getSetting, setSetting } from "./settings";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const sessionVersion = () => Number(getSetting("session_version")) || 0;
/** Révoque tous les cookies existants. Renvoie la nouvelle version. */
export function bumpSessionVersion() {
  const v = sessionVersion() + 1;
  setSetting("session_version", String(v));
  return v;
}

/** Page de connexion : APP_URL + /login (jamais déduit de la requête), ou chemin relatif en développement. */
export const loginUrl = () => (appUrl() ?? "") + "/login";

export async function hasValidSession(): Promise<boolean> {
  const t = await verifyToken((await cookies()).get(COOKIE)?.value);
  return !!t && t.version === sessionVersion();
}

/**
 * À appeler au début de chaque route API, server action et page.
 * - mode "api" (défaut) : lève HttpError(401), transformée en réponse JSON par lib/api.ts ;
 * - mode "redirect" : redirige vers /login (server actions et pages).
 */
export async function requireSession(mode: "api" | "redirect" = "api"): Promise<void> {
  if (await hasValidSession()) return;
  if (mode === "redirect") redirect(loginUrl());
  throw new HttpError(401, "Non autorisé");
}
