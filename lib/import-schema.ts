import { z } from "zod";
import { IMPORT_FIELDS, MAX_IMPORT_COLS } from "./import";

export const MappingSchema = z.partialRecord(z.enum(IMPORT_FIELDS), z.number().int().min(0).max(MAX_IMPORT_COLS - 1));
export const Token = z.string().regex(/^[0-9a-f]{32}$/, "jeton d'import invalide");
export const DefaultVille = z.string().trim().max(100).default("");
export const ImportBase = z.object({
  token: Token,
  mapping: MappingSchema.optional(),         // absent : correspondance automatique du format détecté
  format: z.enum(["bedolt", "standard"]).optional(),
  defaultVille: DefaultVille,
  // Choix de l'aperçu pour la colonne Niche : valeur repliée → id de niche (0 = sans niche) ou « new » (créer)
  nicheChoices: z.record(z.string().max(200), z.union([z.number().int().min(0).max(2 ** 31), z.literal("new")])).optional(),
});
