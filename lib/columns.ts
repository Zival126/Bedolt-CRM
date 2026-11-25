// Colonnes du tableau Commerces (ordinateur) et de l'export CSV. Sans accès à la base : utilisable côté client.
import { z } from "zod";

export const COLUMNS = [
  { key: "nom", label: "Commerce", sort: "nom", fixed: true },
  { key: "contacts", label: "Contacts", sort: "" },
  { key: "niche", label: "Niche", sort: "niche" },
  { key: "specialite", label: "Spécialité", sort: "" },
  { key: "webscore", label: "Score web", sort: "" },
  { key: "zone", label: "Zone", sort: "zone" },
  { key: "ville", label: "Ville", sort: "ville" },
  { key: "colonia", label: "Colonia", sort: "colonia" },
  { key: "offre", label: "Offre", sort: "offre" },
  { key: "google", label: "Google", sort: "avis" },
  { key: "statut", label: "Statut", sort: "statut" },
  { key: "tel", label: "Téléphone", sort: "tel" },
  { key: "wa", label: "WhatsApp", sort: "" },
  { key: "email", label: "Email", sort: "email" },
  { key: "site", label: "Site web", sort: "site" },
  { key: "reseaux", label: "Réseaux", sort: "" },
  { key: "source", label: "Source", sort: "source" },
  { key: "etiquette", label: "Étiquettes", sort: "" },
  { key: "score", label: "Score IA", sort: "score" },
  { key: "ajout", label: "Ajoutée le", sort: "recent" },
  { key: "actions", label: "Actions", sort: "" },
] as const;
export type ColumnKey = (typeof COLUMNS)[number]["key"];
export const COLUMN_KEYS = COLUMNS.map((c) => c.key) as [ColumnKey, ...ColumnKey[]];
export const DEFAULT_COLUMNS: ColumnKey[] = ["nom", "contacts", "niche", "zone", "offre", "google", "statut", "tel", "actions"];
export const ColumnsSchema = z.array(z.enum(COLUMN_KEYS)).min(1).max(COLUMNS.length)
  .transform((l) => [...new Set(["nom" as ColumnKey, ...l])]);
export const columnLabel = (k: string) => COLUMNS.find((c) => c.key === k)?.label ?? k;

/** Colonnes d'un export CSV (les boutons « Actions » n'y ont pas de sens ; « Contacts » détaillé en colonnes). */
export function csvColumns(cols: ColumnKey[]): string[] {
  const out: string[] = [];
  for (const c of cols) {
    if (c === "actions") continue;
    if (c === "contacts") out.push("tel", "wa", "email", "site");
    else if (c === "google") out.push("note", "avis", "fiche");
    else if (c === "reseaux") out.push("facebook", "instagram");
    else out.push(c);
  }
  return [...new Set(out)];
}
export const CSV_LABELS: Record<string, string> = {
  nom: "Commerce", niche: "Niche", specialite: "Spécialité", webscore: "Score web", zone: "Zone", ville: "Ville", colonia: "Colonia", offre: "Offre", note: "Note Google",
  avis: "Nb d'avis", fiche: "Fiche Google", statut: "Statut", tel: "Téléphone", wa: "WhatsApp", email: "Email", site: "Site web",
  facebook: "Facebook", instagram: "Instagram", source: "Source", etiquette: "Étiquettes", score: "Score IA", ajout: "Ajoutée le",
};

/** Cellule CSV : guillemets doublés ; formules neutralisées (=, +, -, @ en tête → apostrophe) pour Excel. */
export function csvCell(v: unknown, sep: string): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) && !/^\+\d[\d ]+$/.test(s)) s = "'" + s;
  return s.includes(sep) || /["\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}
