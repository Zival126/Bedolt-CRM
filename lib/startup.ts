import { boundToLoopback } from "./bind";
import { appUrl } from "./app-url";

/** Refuse de démarrer en production sans secrets corrects ; fichiers créés en 600 / dossiers en 700. */
export function startupChecks() {
  process.umask(0o077);
  if (process.env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  if ((process.env.SESSION_SECRET ?? "").length < 32)
    problems.push("SESSION_SECRET absent ou trop court (32 caractères minimum). Génère-le avec : openssl rand -hex 32");
  if (!process.env.CRM_PASSWORD) problems.push("CRM_PASSWORD absent.");
  if (!appUrl())
    problems.push("APP_URL absent ou invalide : URL publique du CRM sans chemin, ex. APP_URL=https://crm.bedolt.com");
  if (problems.length) {
    console.error("[bedolt-crm] DÉMARRAGE REFUSÉ — corrige le fichier .env :\n  - " + problems.join("\n  - "));
    process.exit(1);
  }
  if (!boundToLoopback())
    console.warn("[bedolt-crm] ATTENTION : le serveur n'écoute pas sur 127.0.0.1 (lance-le avec -H 127.0.0.1). " +
      "X-Forwarded-For est ignoré : la limite de connexion devient globale.");
}
