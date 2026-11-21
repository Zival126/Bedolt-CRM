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
});
