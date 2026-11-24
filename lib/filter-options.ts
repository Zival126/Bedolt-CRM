// Valeurs proposées dans le panneau de filtres (Commerces, Carte, Pipeline) : une requête par dimension.
import { db } from "./db";
import { distinct, allTags, etatsPresent, sourceKeys } from "./crm";

export function filterOptions() {
  return {
    villes: distinct("ville"), zones: distinct("zone"), offres: distinct("offre"), webs: distinct("presence_web"), tags: allTags(),
    lots: db.prepare("SELECT id, file_name FROM import_batches ORDER BY id DESC LIMIT 30").all() as { id: number; file_name: string }[],
    sources: sourceKeys(), etats: etatsPresent(),
  };
}
