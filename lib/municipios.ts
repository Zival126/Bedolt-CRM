// Liste des municipios proposée dans la recherche DENUE.
// Valeur du dépôt : config/municipios-qroo.json. Pour la personnaliser sans qu'une mise à jour l'écrase,
// copie-la dans data/municipios-qroo.json (fichier local, ignoré par git) et modifie cette copie.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import defaults from "@/config/municipios-qroo.json";

const Schema = z.object({
  entidad: z.string().regex(/^\d{1,2}$/),
  municipios: z.array(z.object({ code: z.string().regex(/^\d{1,3}$/), nom: z.string().min(1).max(100) })).max(500),
});
export type Municipios = z.infer<typeof Schema>;

export const LOCAL_MUNICIPIOS = path.resolve("data/municipios-qroo.json");

export function loadMunicipios(): Municipios {
  try {
    if (fs.existsSync(LOCAL_MUNICIPIOS)) {
      const r = Schema.safeParse(JSON.parse(fs.readFileSync(LOCAL_MUNICIPIOS, "utf8")));
      if (r.success) return r.data;
      console.warn("[bedolt-crm] data/municipios-qroo.json invalide, valeur du dépôt utilisée.");
    }
  } catch (e) {
    console.warn("[bedolt-crm] lecture de data/municipios-qroo.json impossible :", (e as Error).message);
  }
  return Schema.parse(defaults);
}
