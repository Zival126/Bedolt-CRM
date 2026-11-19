import { db } from "./db";

export type SettingKey =
  | "denue_token" | "ollama_url" | "ollama_model" | "n8n_url" | "ia_provider" | "ia_mode"
  | "ia_system_prompt" | "ia_criteria" | "tpl_first" | "tpl_j2" | "tpl_j7" | "session_version";

export function getSetting(key: SettingKey): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? "";
}
export function setSetting(key: SettingKey, value: string) {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}
/** Le token en base prime ; `DENUE_TOKEN` du .env sert de valeur par défaut. */
export const denueToken = () => getSetting("denue_token") || process.env.DENUE_TOKEN || "";
export const maskToken = (t: string) => (t ? "••••••••" + t.slice(-4) : "");

export const DEFAULT_SYSTEM_PROMPT =
  "Tu es l'assistant du CRM de Bedolt, une agence qui crée des fiches Google et des sites web pour des commerces locaux de la Riviera Maya. " +
  "Réponds en français, de façon concise. Utilise les outils pour lire les données du CRM avant de répondre ; n'invente jamais de données.";
export const DEFAULT_CRITERIA =
  "Priorité haute : commerce sans fiche Google ou avec une fiche vide, téléphone disponible, intérêt chaud. Priorité basse : fiche Google complète avec beaucoup d'avis, pas de téléphone.";
export const systemPrompt = () => getSetting("ia_system_prompt") || DEFAULT_SYSTEM_PROMPT;
export const criteria = () => getSetting("ia_criteria") || DEFAULT_CRITERIA;
