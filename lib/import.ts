import ExcelJS from "exceljs";
import { findDuplicate, insertBusiness, updateBusiness } from "./crm";
import { telNorm } from "./phone";
import { normHeader } from "./import-shared";

export const IMPORT_FIELDS = ["nom", "activite", "telephone", "whatsapp", "email", "site_web", "adresse", "colonia", "ville",
  "fiche_google", "lien_google_maps", "note_google", "nb_avis", "latitude", "longitude", "notes"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type Mapping = Partial<Record<ImportField, number>>; // champ -> index de colonne

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 Mo
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_COLS = 100;

/** minuscules, sans accents, sans espaces/ponctuation : « Fiche Google » == « fiche_google ». */
export { normHeader };

const ALIASES: Partial<Record<ImportField, string[]>> = {
  nom: ["nombre", "name", "commerce", "negocio"],
  activite: ["activity", "actividad", "categorie", "categoria", "categorie"],
  telephone: ["telefono", "tel", "phone", "celular"],
  site_web: ["sitioweb", "web", "website", "siteweb", "sitio"],
  ville: ["ciudad", "city", "municipio"],
  fiche_google: ["fichegoogle", "googlebusiness", "ficha"],
  lien_google_maps: ["liengooglemaps", "googlemaps", "maps", "lienmaps", "lien"],
  note_google: ["notegoogle", "rating", "calificacion", "note"],
  nb_avis: ["nbavis", "avis", "reviews", "resenas", "nombreavis"],
  latitude: ["lat", "latitud"], longitude: ["lng", "lon", "long", "longitud"],
  adresse: ["direccion", "address"], notes: ["notas", "comentarios", "remarques"],
};

export function autoMapping(headers: string[]): Mapping {
  const norm = headers.map(normHeader);
  const m: Mapping = {};
  for (const f of IMPORT_FIELDS) {
    const keys = [normHeader(f), ...(ALIASES[f] ?? [])];
    const i = norm.findIndex((h) => keys.includes(h));
    if (i >= 0) m[f] = i;
  }
  return m;
}

// ---------- Lecture des fichiers ----------
function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("text" in o) return String(o.text ?? "");                  // lien hypertexte
    if ("result" in o) return String(o.result ?? "");              // formule
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
};

export async function readFile(name: string, buf: Buffer): Promise<{ headers: string[]; rows: string[][] }> {
  let all: string[][];
  if (/\.xlsx$/i.test(name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("Classeur vide.");
    all = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(cellText(row.getCell(c).value).trim());
      all.push(vals);
    });
  } else if (/\.csv$/i.test(name)) {
    all = parseCsv(buf.toString("utf8"));
  } else throw new Error("Format non géré : utilise un fichier .xlsx ou .csv.");
  if (all.length < 1) throw new Error("Fichier vide.");
  if (all.length - 1 > MAX_IMPORT_ROWS) throw new Error(`Trop de lignes : ${all.length - 1} (maximum ${MAX_IMPORT_ROWS.toLocaleString("fr-FR")}). Découpe le fichier.`);
  if (all[0].length > MAX_IMPORT_COLS) throw new Error(`Trop de colonnes : ${all[0].length} (maximum ${MAX_IMPORT_COLS}).`);
  return { headers: all[0], rows: all.slice(1).map((r) => r.slice(0, MAX_IMPORT_COLS)) };
}

export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Commerces");
  ws.addRow([...IMPORT_FIELDS]);
  ws.getRow(1).font = { bold: true };
  IMPORT_FIELDS.forEach((_, i) => (ws.getColumn(i + 1).width = 18));
  ws.addRow(["(exemple — à supprimer)", "Salon de beauté", "998 123 4567", "", "", "", "Calle 1 #2", "Centro", "Puerto Morelos", "non", "", 4.6, 12, "", "", ""]);
  const help = wb.addWorksheet("Aide");
  [["Colonne", "Règle"], ["nom", "Obligatoire"], ["fiche_google", "oui, non ou vide (fiche existante mais vide)"],
    ["note_google", "Nombre décimal, ex. 4.6"], ["nb_avis", "Entier"], ["latitude / longitude", "Nombres décimaux"],
    ["Autres colonnes", "Optionnelles. 1 ligne = 1 commerce, ligne 1 = en-têtes."]].forEach((r) => help.addRow(r));
  help.getColumn(1).width = 22; help.getColumn(2).width = 60;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- Validation ----------
type Rec = Record<string, string | number | null>;
export type Parsed = { rec?: Rec; error?: string };

const FICHE: Record<string, string> = { oui: "oui", si: "oui", yes: "oui", true: "oui", "1": "oui", non: "non", no: "non", false: "non", "0": "non", vide: "vide", vacio: "vide", empty: "vide" };
const dec = (s: string) => { const n = Number(s.replace(",", ".")); return s === "" ? null : isNaN(n) ? NaN : n; };

export function parseRow(row: string[], m: Mapping): Parsed {
  const get = (f: ImportField) => (m[f] === undefined ? "" : (row[m[f]!] ?? "").trim());
  const nom = get("nom");
  if (!nom) return { error: "Nom manquant" };
  const fiche = normHeader(get("fiche_google"));
  if (fiche && !(fiche in FICHE)) return { error: `fiche_google invalide (« ${get("fiche_google")} » : oui, non ou vide)` };
  const note = dec(get("note_google")), avis = dec(get("nb_avis")), lat = dec(get("latitude")), lng = dec(get("longitude"));
  if (Number.isNaN(note)) return { error: "note_google n'est pas un nombre" };
  if (Number.isNaN(avis) || (avis !== null && !Number.isInteger(avis))) return { error: "nb_avis n'est pas un entier" };
  if (Number.isNaN(lat) || Number.isNaN(lng)) return { error: "latitude/longitude invalides" };
  const tel = get("telephone");
  if (tel && !telNorm(tel)) return { error: `Téléphone non reconnu (« ${tel} »)` };
  const wa = get("whatsapp");
  if (wa && !telNorm(wa)) return { error: `WhatsApp non reconnu (« ${wa} ») : numéro mexicain à 10 chiffres attendu` };
  return { rec: {
    nom, activite: get("activite"), telephone: tel, whatsapp: wa, email: get("email"), site_web: get("site_web"),
    adresse: get("adresse"), colonia: get("colonia"), ville: get("ville"), fiche_google: fiche ? FICHE[fiche] : "",
    lien_google: get("lien_google_maps"), note_google: note, nb_avis: avis, lat, lng, notes: get("notes"),
  } };
}

export type PreviewRow = { line: number; nom?: string; error?: string; duplicate?: { id: number; nom: string; reason: string } };

export function preview(rows: string[][], m: Mapping) {
  const out: PreviewRow[] = [];
  const seen = new Map<string, number>(); // doublons à l'intérieur du fichier
  rows.forEach((row, i) => {
    const p = parseRow(row, m);
    const line = i + 2;
    if (p.error) return out.push({ line, nom: row[m.nom ?? -1], error: p.error });
    const r = p.rec!;
    const dup = findDuplicate({ telephone: String(r.telephone), whatsapp: String(r.whatsapp), nom: String(r.nom), ville: String(r.ville) }, true);
    const key = telNorm(String(r.telephone)) || `${String(r.nom).toLowerCase()}|${String(r.ville).toLowerCase()}`;
    if (dup) {
      const reason = telNorm(String(r.telephone)) && dup.tel_norm === telNorm(String(r.telephone)) ? "même téléphone" : "même nom + ville";
      out.push({ line, nom: String(r.nom), duplicate: { id: dup.id, nom: dup.nom, reason } });
    } else if (seen.has(key)) {
      out.push({ line, nom: String(r.nom), error: `Doublon dans le fichier (ligne ${seen.get(key)})` });
    } else {
      seen.set(key, line);
      out.push({ line, nom: String(r.nom) });
    }
  });
  return {
    total: out.length,
    valid: out.filter((r) => !r.error && !r.duplicate).length,
    errors: out.filter((r) => r.error),
    duplicates: out.filter((r) => r.duplicate),
  };
}

export function commit(rows: string[][], m: Mapping, fileName: string, onDuplicate: "ignore" | "update") {
  let added = 0, updated = 0, ignored = 0, errors = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    const p = parseRow(row, m);
    if (p.error) { errors++; continue; }
    const r = p.rec!;
    const key = telNorm(String(r.telephone)) || `${String(r.nom).toLowerCase()}|${String(r.ville).toLowerCase()}`;
    const dup = findDuplicate({ telephone: String(r.telephone), whatsapp: String(r.whatsapp), nom: String(r.nom), ville: String(r.ville) }, true);
    if (!dup && seen.has(key)) { errors++; continue; }
    if (dup) {
      if (onDuplicate === "update") {
        // Met à jour uniquement les champs renseignés dans le fichier.
        const patch = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "" && v !== null));
        updateBusiness(dup.id, patch as never);
        updated++;
      } else ignored++;
      continue;
    }
    seen.add(key);
    insertBusiness({ ...(r as Record<string, never>), nom: String(r.nom), source: "Excel", source_detail: fileName });
    added++;
  }
  return { added, updated, ignored, errors };
}
