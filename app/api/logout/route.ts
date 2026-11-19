import { COOKIE } from "@/lib/auth";
import { route } from "@/lib/api";
import { redirectTo } from "@/lib/app-url";

// Exception assumée à requireSession() : se déconnecter n'expose aucune donnée et doit marcher même avec un
// cookie expiré ou révoqué (sinon l'utilisateur verrait une erreur 401 au lieu de la page de connexion).
export const POST = route(async () => {
  const res = redirectTo("/login", 303); // APP_URL, jamais req.url
  res.cookies.delete(COOKIE);
  return res;
});
