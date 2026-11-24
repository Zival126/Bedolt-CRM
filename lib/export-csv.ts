// Export CSV des fiches filtrées (Commerces) : UTF-8 avec BOM (Excel reconnaît les accents et les emojis), CRLF.
import { db } from "./db";
import { idsForFilter, waState, sourcesOf, type Business } from "./crm";
import { readFilters, type SP } from "./filters";
import { withQueue } from "./queue";
import { COLUMN_KEYS, csvColumns, csvCell, CSV_LABELS, type ColumnKey } from "./columns";
import { commerceColumns } from "./views";
import { statutLabel, motifLabel, ficheLabel } from "./constants";
import { prettyPhone } from "./phone";

export const MAX_EXPORT = 20_000;

function value(b: Business, k: string): unknown {
  switch (k) {
    case "statut": return statutLabel(b.statut) + (b.statut === "perdu" ? ` (${motifLabel(b.perdu_motif)})` : "") + (b.ne_pas_contacter ? " · ne pas contacter" : "");
    case "tel": return b.tel_norm ? prettyPhone(b.telephone || b.tel_norm) : b.telephone;
    case "wa": return waState(b);
    case "site": return b.site_web;
    case "note": return b.note_google == null ? "" : String(b.note_google).replace(".", ",");
    case "avis": return b.nb_avis ?? "";
    case "fiche": return ficheLabel(b.fiche_google);
    case "ajout": return (b.created_at ?? "").slice(0, 10);
    case "score": return b.score ?? "";
    case "source": return sourcesOf(b).join(", ") || b.source;
    default: return (b as unknown as Record<string, unknown>)[k] ?? "";
  }
}

/** `sp` : paramètres de l'URL de la liste (+ cols=…, sep=; ou ,). */
export function buildCsv(sp: SP): { body: string; rows: number } {
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const sep = one("sep") === "," ? "," : ";";
  const colsParam = (one("cols") ?? "").split(",").filter((c): c is ColumnKey => (COLUMN_KEYS as string[]).includes(c));
  const cols = csvColumns(colsParam.length ? colsParam : commerceColumns());
  const ids = idsForFilter(withQueue(readFilters(sp).f), MAX_EXPORT);
  const lines = [cols.map((c) => csvCell(CSV_LABELS[c] ?? c, sep)).join(sep)];
  const get = db.prepare("SELECT * FROM businesses WHERE id = ?");
  for (const id of ids) {
    const b = get.get(id) as Business | undefined;
    if (b) lines.push(cols.map((c) => csvCell(value(b, c), sep)).join(sep));
  }
  return { body: "﻿" + lines.join("\r\n") + "\r\n", rows: lines.length - 1 };
}
