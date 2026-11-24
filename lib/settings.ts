import { z } from "zod";
import { db } from "./db";
import { DEFAULT_NEW_GOAL, DEFAULT_NEW_HARD, DEFAULT_RELANCES, MAX_NEW_HARD } from "./constants";

export type SettingKey =
  | "denue_token" | "ollama_url" | "ollama_model" | "n8n_url" | "ia_provider" | "ia_mode"
  | "ia_system_prompt" | "ia_criteria" | "tpl_first" | "tpl_j2" | "tpl_j7" | "session_version"
  | "objectives" | "denue_niches" | "commerce_columns" | "geo_favoris";

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

// ---------- Réglages > Objectifs ----------
const list = z.array(z.string().max(200)).max(200).default([]);
export const QUEUE_ORDERS = [
  { key: "offre_avis", label: "Offre (P1→P3) puis nb d'avis" },
  { key: "avis", label: "Nb d'avis seul" },
  { key: "recent", label: "Date d'ajout (récentes d'abord)" },
] as const;
/** '' dans une liste = « non renseigné ». Listes vides = pas de filtre sur cette dimension. */
export const ObjectivesSchema = z.object({
  newGoal: z.number().int().min(0).max(MAX_NEW_HARD).default(DEFAULT_NEW_GOAL),
  newHard: z.number().int().min(1).max(MAX_NEW_HARD).default(DEFAULT_NEW_HARD),
  relances: z.number().int().min(0).max(500).default(DEFAULT_RELANCES),
  filter: z.object({
    niches: list, zones: list, offres: list, villes: list,
    fiches: z.array(z.enum(["", "oui", "non", "vide", "verifier"])).max(5).default([]),
    avisMin: z.number().int().min(0).max(10_000_000).nullable().default(null),
  }).default({ niches: [], zones: [], offres: [], villes: [], fiches: [], avisMin: null }),
  order: z.enum(["offre_avis", "avis", "recent"]).default("offre_avis"),
}).refine((o) => o.newGoal <= o.newHard, { message: "l'objectif de nouveaux WhatsApp ne peut pas dépasser la limite dure", path: ["newGoal"] });
export type Objectives = z.infer<typeof ObjectivesSchema>;

/** Objectifs enregistrés (valeurs par défaut si absents ou illisibles). */
export function objectives(): Objectives {
  let raw: unknown = {};
  try { raw = JSON.parse(getSetting("objectives") || "{}"); } catch { raw = {}; }
  const r = ObjectivesSchema.safeParse(raw);
  return r.success ? r.data : ObjectivesSchema.parse({});
}
export const saveObjectives = (o: Objectives) => setSetting("objectives", JSON.stringify(o));
