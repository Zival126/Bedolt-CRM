import { z } from "zod";
import { IMPORT_FIELDS, MAX_IMPORT_COLS, MAX_IMPORT_ROWS } from "./import";

export const Rows = z.array(z.array(z.string().max(5000)).max(MAX_IMPORT_COLS))
  .max(MAX_IMPORT_ROWS, `${MAX_IMPORT_ROWS.toLocaleString("fr-FR")} lignes maximum`);
export const MappingSchema = z.partialRecord(z.enum(IMPORT_FIELDS), z.number().int().min(0).max(MAX_IMPORT_COLS - 1));
