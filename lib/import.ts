// Import Excel / CSV : lecture du fichier (côté serveur), reconnaissance du format, validation, aperçu, insertion
// par lots dans UNE transaction SQLite (tout ou rien), annulation d'un lot.
import ExcelJS from "exceljs";
import { db, now, today, addDays } from "./db";
import { setStatus, type Business } from "./crm";
import { telNorm, waNumber, safeHttpUrl } from "./phone";
import { normHeader } from "./import-shared";
import { normalizeSocial, socialHref, isEmail } from "./contacts";
import { addSourceTag } from "./sources";
import { enqueueEnrich } from "./enrich-queue";
import { allNiches, matchNicheText, createNiche, type NicheRow } from "./niches";
import { classifyText, foldText, MAIN_NICHES } from "./niche-classify";

/** « monsalon.mx » → https://monsalon.mx ; '' si ce n'est pas une adresse web. */
const siteUrl = (s: string) => {
  const v = s.trim();
  if (!v) return "";
  const u = safeHttpUrl(/^https?:\/\//i.test(v) ? v : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) ? "https://" + v : "");
  return u;
};
import { STATUTS, STATUT_RANK, VILLES_IMPORT } from "./constants";

export const IMPORT_FIELDS = ["nom", "activite", "telephone", "whatsapp", "email", "site_web", "adresse", "colonia", "ville",
  "fiche_google", "lien_google_maps", "note_google", "nb_avis", "latitude", "longitude", "notes",
  "statut", "niche", "offre", "presence_web", "angle", "zone", "message_whatsapp", "facebook", "instagram", "specialite"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type Mapping = Partial<Record<ImportField, number>>; // champ -> index de colonne
export type ImportFormat = "bedolt" | "standard";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 Mo
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_COLS = 100;
export const MAX_CELL = 5000;

export { normHeader };

// ---------- Formats ----------
/**
 * « Format prospects Bedolt » (= format demandé à Gemini, 18 colonnes) : en-têtes fixes, en français.
 * Attention : « Notes » y contient la ZONE (quartier / colonia).
 */
export const BEDOLT_COLUMNS: [string, ImportField][] = [
  ["Entreprise", "nom"], ["Téléphone", "telephone"], ["Statut", "statut"], ["Niche", "niche"], ["Offre", "offre"],
  ["Présence web", "presence_web"], ["Angle", "angle"], ["Notes", "zone"], ["Note Google", "note_google"], ["Avis", "nb_avis"],
  ["Lien Google Maps", "lien_google_maps"], ["Message WhatsApp", "message_whatsapp"],
];

/** Ajoutées au format Bedolt quand le fichier les contient (Email, Site web, Facebook, Instagram, Adresse, Ville…). */
const BEDOLT_OPTIONAL: ImportField[] = ["specialite", "email", "site_web", "facebook", "instagram", "adresse", "ville"];
/** Les 19 colonnes du fichier Gemini / modèle, dans l'ordre (« Spécialité » = le détail, la Niche reste la catégorie). */
export const GEMINI_HEADERS = ["Entreprise", "Téléphone", "Statut", "Niche", "Spécialité", ...BEDOLT_COLUMNS.slice(4).map(([h]) => h), "Email", "Site web", "Facebook", "Instagram", "Adresse", "Ville"];

const ALIASES: Partial<Record<ImportField, string[]>> = {
  nom: ["nombre", "name", "commerce", "negocio", "entreprise", "empresa"],
  activite: ["activity", "actividad", "categorie", "categoria"],
  telephone: ["telefono", "tel", "phone", "celular"],
  email: ["correo", "correoelectronico", "mail", "courriel", "emailcontacto"],
  site_web: ["sitioweb", "web", "website", "siteweb", "sitio", "site", "paginaweb", "sitiointernet"],
  facebook: ["fb", "paginafacebook", "pagefacebook"], instagram: ["ig", "insta", "compteinstagram", "cuentainstagram"],
  ville: ["ciudad", "city", "municipio"],
  fiche_google: ["fichegoogle", "googlebusiness", "ficha"],
  lien_google_maps: ["liengooglemaps", "googlemaps", "maps", "lienmaps", "lien"],
  note_google: ["notegoogle", "rating", "calificacion", "note"],
  nb_avis: ["nbavis", "avis", "reviews", "resenas", "nombreavis"],
  latitude: ["lat", "latitud"], longitude: ["lng", "lon", "long", "longitud"],
  adresse: ["direccion", "address"], notes: ["notas", "comentarios", "remarques"],
  statut: ["status", "estatus", "estado"], niche: ["nicho", "secteur"], offre: ["oferta", "offer"],
  specialite: ["especialidad", "specialty", "speciality", "sousniche", "detail"],
  presence_web: ["presenceweb", "presencia", "presenciaweb"], angle: ["argument", "pitch"],
  zone: ["zona", "quartier", "secteurgeo"], message_whatsapp: ["messagewhatsapp", "mensajewhatsapp", "message", "mensaje"],
};

export function detectFormat(headers: string[]): ImportFormat {
  const norm = new Set(headers.map(normHeader));
  const hits = BEDOLT_COLUMNS.filter(([h]) => norm.has(normHeader(h))).length;
  return norm.has("entreprise") && hits >= 8 ? "bedolt" : "standard";
}

export function mappingFor(format: ImportFormat, headers: string[]): Mapping {
  const norm = headers.map(normHeader);
  const m: Mapping = {};
  if (format === "bedolt") {
    for (const [h, f] of BEDOLT_COLUMNS) { const i = norm.indexOf(normHeader(h)); if (i >= 0) m[f] = i; }
    // Colonnes de contact facultatives (email, site, réseaux) si elles existent dans le fichier
    const used = new Set(Object.values(m));
    for (const f of BEDOLT_OPTIONAL) {
      const keys = [normHeader(f), ...(ALIASES[f] ?? [])];
      const i = norm.findIndex((h, j) => !used.has(j) && keys.includes(h));
      if (i >= 0) { m[f] = i; used.add(i); }
    }
    return m;
  }
  const used = new Set<number>();
  for (const f of IMPORT_FIELDS) {
    const keys = [normHeader(f), ...(ALIASES[f] ?? [])];
    const i = norm.findIndex((h, j) => !used.has(j) && keys.includes(h));
    if (i >= 0) { m[f] = i; used.add(i); }
  }
  return m;
}

export const unknownColumns = (headers: string[], m: Mapping) => {
  const used = new Set(Object.values(m));
  return headers.map((h, i) => ({ h, i })).filter(({ h, i }) => !used.has(i) && h.trim() !== "").map(({ h }) => h);
};

// ---------- Lecture des fichiers ----------
function decodeText(buf: Buffer): { text: string; warning?: string } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf) };
  } catch {
    // CSV « Windows » (Excel français) : Windows-1252. Les emojis n'existent pas dans cet encodage.
    return { text: new TextDecoder("windows-1252").decode(buf), warning: "Fichier CSV non UTF-8 : lu en Windows-1252 (exporte en « CSV UTF-8 » pour garder les emojis)." };
  }
}

export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  // Séparateur : le plus fréquent sur la ligne d'en-tête, hors guillemets.
  let first = "", q = false;
  for (const c of text) { if (c === '"') q = !q; else if (!q && (c === "\n" || c === "\r")) break; else if (!q) first += c; }
  const count = (d: string) => first.split(d).length - 1;
  const delim = [";", ",", "\t"].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "";
  q = false;
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

const cellText = (v: ExcelJS.CellValue): { text: string; link?: string } => {
  if (v == null) return { text: "" };
  if (v instanceof Date) return { text: v.toISOString() };
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("hyperlink" in o || "text" in o) {
      const t = o.text;
      const text = typeof t === "object" && t && "richText" in (t as object)
        ? ((t as { richText: { text: string }[] }).richText).map((x) => x.text).join("") : String(t ?? "");
      return { text, link: typeof o.hyperlink === "string" ? o.hyperlink : undefined };
    }
    if ("richText" in o) return { text: (o.richText as { text: string }[]).map((t) => t.text).join("") };
    if ("error" in o) return { text: "" };
    if ("result" in o) return cellText(o.result as ExcelJS.CellValue);
    if ("formula" in o || "sharedFormula" in o) return { text: "" };
    return { text: "" };
  }
  return { text: String(v) };
};

export type FileData = { headers: string[]; rows: string[][]; links: Record<string, string>; warnings: string[] };

export async function readFile(name: string, buf: Buffer): Promise<FileData> {
  let all: string[][];
  const links: Record<string, string> = {}; // « ligne:colonne » (index dans rows) -> URL d'un lien hypertexte Excel
  const warnings: string[] = [];
  if (/\.xlsx$/i.test(name)) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf as unknown as ArrayBuffer); } catch { throw new Error("Fichier .xlsx illisible."); }
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("Classeur vide.");
    if (ws.rowCount - 1 > MAX_IMPORT_ROWS * 2) throw new Error(`Trop de lignes (maximum ${MAX_IMPORT_ROWS.toLocaleString("fr-FR")}). Découpe le fichier.`);
    const ncol = Math.min(ws.columnCount, MAX_IMPORT_COLS + 1);
    all = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals: string[] = [];
      for (let c = 1; c <= ncol; c++) {
        const t = cellText(row.getCell(c).value);
        vals.push(t.text.trim());
        if (t.link && all.length > 0) links[`${all.length - 1}:${c - 1}`] = t.link;
      }
      if (vals.some((x) => x !== "")) all.push(vals);
    });
  } else if (/\.csv$/i.test(name)) {
    const d = decodeText(buf);
    if (d.warning) warnings.push(d.warning);
    all = parseCsv(d.text);
  } else throw new Error("Format non géré : utilise un fichier .xlsx ou .csv.");
  if (all.length < 1) throw new Error("Fichier vide.");
  if (all.length - 1 > MAX_IMPORT_ROWS) throw new Error(`Trop de lignes : ${all.length - 1} (maximum ${MAX_IMPORT_ROWS.toLocaleString("fr-FR")}). Découpe le fichier.`);
  if (all[0].length > MAX_IMPORT_COLS) throw new Error(`Trop de colonnes : ${all[0].length} (maximum ${MAX_IMPORT_COLS}).`);
  const cut = (r: string[]) => r.slice(0, MAX_IMPORT_COLS).map((x) => (x.length > MAX_CELL ? x.slice(0, MAX_CELL) : x));
  if (all.length < 2) throw new Error("Aucune ligne de données sous les en-têtes.");
  return { headers: cut(all[0]).map((h) => h.trim()), rows: all.slice(1).map(cut), links, warnings };
}

// ---------- Modèles téléchargeables ----------
export const GEMINI_EXAMPLE = ["(exemple — à supprimer) Salón Bella", "+52 998 126 8091", "À contacter", "Beauté & coiffure", "Coloration & balayage", "P1", "Aucun site",
  "Fiche Google sans photos ni horaires", "SM 22", "4.6", "124",
  "https://www.google.com/maps/search/?api=1&query=Sal%C3%B3n%20Bella%20Canc%C3%BAn%2C%20Quintana%20Roo",
  "¡Hola Salón Bella! 👋 Vi su ficha en Google Maps…", "", "", "https://www.facebook.com/salonbella", "", "Av. Tulum 12", "Cancún"];
/** Modèle CSV (UTF-8 avec BOM, virgule, champs entre guillemets) : exactement le format demandé à Gemini. */
export const csvTemplate = () => "\uFEFF" + [GEMINI_HEADERS, GEMINI_EXAMPLE].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";

export async function buildTemplate(format: ImportFormat = "bedolt"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Prospects");
  if (format === "bedolt") {
    ws.addRow(GEMINI_HEADERS);
    ws.addRow(GEMINI_EXAMPLE);
    [34, 18, 14, 22, 8, 14, 40, 24, 12, 8, 50, 60, 26, 28, 30, 30, 34, 16].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  } else {
    ws.addRow([...IMPORT_FIELDS]);
    IMPORT_FIELDS.forEach((_, i) => (ws.getColumn(i + 1).width = 18));
    ws.addRow(["(exemple — à supprimer)", "Salon de beauté", "998 123 4567", "", "", "", "Calle 1 #2", "Centro", "Puerto Morelos", "non", "", 4.6, 12, "", "", "",
      "À contacter", "Beauté & coiffure", "P2", "Aucun site", "", "Centre", ""]);
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const help = wb.addWorksheet("Aide");
  const rows = format === "bedolt" ? [
    ["Colonne", "Règle"], ["Entreprise", "Obligatoire"], ["Téléphone", "Numéro mexicain, ex. +52 998 126 8091 (sert aussi pour WhatsApp)"],
    ["Statut", STATUTS.map((s) => s.label).join(", ") + ", Pas intéressé (= Perdu, motif Pas intéressé) — vide ou inconnu : À contacter"],
    ["Niche / Offre / Présence web", "Texte libre (Offre : P1, P2 ou P3 ; P1 = priorité)"], ["Angle", "Argument de vente affiché dans la vue d'appel"],
    ["Notes", "ZONE du commerce (ex. Centre-Ville & Urbain) — pas une note"], ["Note Google", "Décimal, ex. 4.6 (vide accepté)"],
    ["Avis", "Entier, ex. 124 ou 124.0 (vide accepté)"], ["Lien Google Maps", "Lien de recherche Maps : la ville est déduite de query=…"],
    ["Message WhatsApp", "Premier message personnalisé (emojis acceptés)"],
    ["Email / Site web / Facebook / Instagram", "Facultatifs : adresse email, adresse web complète, liens des pages"], ["Adresse / Ville", "Facultatifs (la ville est sinon déduite du lien Maps)"],
    ["Niche", "Une niche principale du CRM (page Niches). Une valeur inconnue est classée par mots-clés, sinon « Sans niche » : aucune niche n'est créée sans ton accord"],
    ["Spécialité", "Le détail (ex. « Orthodontie », « Freins & suspension ») : jamais dans la colonne Niche"],
    ["Limites", "5 Mo, 5 000 lignes. 1 ligne = 1 commerce, ligne 1 = en-têtes."],
  ] : [
    ["Colonne", "Règle"], ["nom", "Obligatoire"], ["fiche_google", "oui, non, vide ou à vérifier"],
    ["note_google", "Nombre décimal, ex. 4.6"], ["nb_avis", "Entier"], ["latitude / longitude", "Nombres décimaux"],
    ["Autres colonnes", "Optionnelles. 1 ligne = 1 commerce, ligne 1 = en-têtes."],
  ];
  rows.forEach((r) => help.addRow(r));
  help.getRow(1).font = { bold: true };
  help.getColumn(1).width = 28; help.getColumn(2).width = 90;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- Validation d'une ligne ----------
export type Rec = {
  nom: string; activite: string; telephone: string; whatsapp: string; email: string; site_web: string; adresse: string;
  colonia: string; ville: string; fiche_google: string; lien_google: string; note_google: number | null; nb_avis: number | null;
  lat: number | null; lng: number | null; notes: string; statut: string; niche: string; specialite: string; offre: string; presence_web: string;
  angle: string; zone: string; message_whatsapp: string; facebook: string; instagram: string;
  /** Statut Perdu : motif déduit du libellé (« Pas intéressé » → pas_interesse). */
  motif?: string;
};
export type Parsed = { rec?: Rec; error?: string; warnings: string[] };
/** nicheChoices : valeur de la colonne Niche (repliée) → id de niche (0 = sans niche) ou « new » (créer cette niche). */
export type ParseOpts = { defaultVille: string; nicheChoices?: Record<string, number | "new"> };

const FICHE: Record<string, string> = {
  oui: "oui", si: "oui", yes: "oui", true: "oui", "1": "oui", non: "non", no: "non", false: "non", "0": "non",
  vide: "vide", vacio: "vide", empty: "vide", verifier: "verifier", averifier: "verifier", porverificar: "verifier",
};
const STATUT_IN: Record<string, string> = {
  ...Object.fromEntries(STATUTS.flatMap((s) => [[normHeader(s.label), s.key], [normHeader(s.key), s.key]])),
  repondu: "a_repondu", nouveau: "a_contacter", porcontactar: "a_contacter", contactado: "contacte", respondio: "a_repondu",
  interesado: "interesse", pagado: "paye", nointeresado: "perdu", pasinteresse: "perdu", perdido: "perdu", lost: "perdu",
};

const dec = (s: string): number | null => {
  if (s === "") return null;
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
/** « 124 », « 124.0 », « 1 234 », « 1,234 » -> 124 / 1234. */
const intOf = (s: string): number | null => {
  if (s === "") return null;
  const t = s.replace(/\s/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(t) && !/^\d+[.,]0+$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  const n = dec(t);
  if (n === null || Number.isNaN(n) || !Number.isInteger(n) || n < 0) return NaN;
  return n;
};
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Villes reconnues dans le paramètre query d'un lien Maps (nom canonique, avec accents).
const KNOWN_CITIES = [...VILLES_IMPORT, "Cozumel", "Isla Mujeres", "Bacalar", "Chetumal", "Holbox", "Akumal", "Puerto Aventuras",
  "Felipe Carrillo Puerto", "José María Morelos", "Mahahual", "Chiquilá", "Kantunilkín", "Leona Vicario", "Xpu-Ha", "Chemuyil", "Valladolid", "Mérida"];
const CITY_RE = KNOWN_CITIES.map((c) => ({ c, re: new RegExp(`(^|[^a-z])${plain(c).replace(/[-.]/g, "[- .]?")}(?![a-z])`, "g") }));
const REGION = /^(quintana roo|q\.? ?roo|qroo|mexico|mx|yucatan)$/;

/** « …Cancún, Quintana Roo » -> « Cancún ». '' si rien de fiable. */
export function villeFromMapsUrl(url: string): string {
  let q = "";
  try {
    const u = new URL(url);
    q = u.searchParams.get("query") ?? u.searchParams.get("q") ?? "";
    if (!q) { const m = u.pathname.match(/\/maps\/(?:search|place)\/([^/]+)/); if (m) q = decodeURIComponent(m[1].replace(/\+/g, " ")); }
  } catch { return ""; }
  if (!q) return "";
  const p = plain(q);
  let best: { c: string; end: number } | null = null;
  for (const { c, re } of CITY_RE) {
    re.lastIndex = 0;
    for (let m = re.exec(p); m; m = re.exec(p)) {
      const end = m.index + m[0].length;
      if (!best || end > best.end) best = { c, end };
    }
  }
  if (best) return best.c;
  const parts = q.split(",").map((x) => x.trim()).filter(Boolean);
  while (parts.length && REGION.test(plain(parts[parts.length - 1]).replace(/\d{5}/, "").trim())) parts.pop();
  if (parts.length >= 2) {
    const v = parts[parts.length - 1].replace(/\b\d{5}\b/g, "").trim();
    if (v && v.length <= 40 && !/\d/.test(v)) return v;
  }
  return "";
}

export function parseRow(row: string[], m: Mapping, opts: ParseOpts, link?: (col: number) => string | undefined): Parsed {
  const warnings: string[] = [];
  const get = (f: ImportField) => (m[f] === undefined ? "" : (row[m[f]!] ?? "").trim());
  const nom = cap(get("nom"), 300);
  if (!nom) return { error: "Nom (Entreprise) manquant", warnings };

  const tel = get("telephone");
  if (tel && !telNorm(tel)) return { error: `Téléphone non reconnu (« ${cap(tel, 40)} ») : numéro mexicain à 10 chiffres attendu`, warnings };
  const wa = get("whatsapp");
  if (wa && !telNorm(wa)) return { error: `WhatsApp non reconnu (« ${cap(wa, 40)} »)`, warnings };

  const note = dec(get("note_google"));
  if (Number.isNaN(note) || (note !== null && (note < 0 || note > 5))) return { error: `Note Google invalide (« ${cap(get("note_google"), 20)} » : nombre entre 0 et 5)`, warnings };
  const avis = intOf(get("nb_avis"));
  if (Number.isNaN(avis)) return { error: `Avis invalide (« ${cap(get("nb_avis"), 20)} » : nombre entier)`, warnings };
  const lat = dec(get("latitude")), lng = dec(get("longitude"));
  if (Number.isNaN(lat) || Number.isNaN(lng) || (lat !== null && Math.abs(lat) > 90) || (lng !== null && Math.abs(lng) > 180))
    return { error: "latitude/longitude invalides", warnings };

  const ficheRaw = normHeader(get("fiche_google"));
  if (ficheRaw && !(ficheRaw in FICHE)) return { error: `fiche_google invalide (« ${cap(get("fiche_google"), 20)} » : oui, non, vide ou à vérifier)`, warnings };
  // Règle : une note ou des avis prouvent l'existence de la fiche ; sinon « à vérifier » (jamais « non » d'office).
  const fiche = ficheRaw ? FICHE[ficheRaw] : note !== null || avis !== null ? "oui" : "verifier";

  const statutRaw = get("statut");
  let statut = "a_contacter";
  if (statutRaw) {
    const k = STATUT_IN[normHeader(statutRaw)];
    if (k) statut = k; else warnings.push(`Statut inconnu « ${cap(statutRaw, 30)} » → À contacter`);
  }
  const nh = normHeader(statutRaw);
  const motif = statut !== "perdu" ? undefined : ["pasinteresse", "nointeresado"].includes(nh) ? "pas_interesse" : "autre";

  let lien = get("lien_google_maps");
  const col = m.lien_google_maps;
  if (lien && !safeHttpUrl(lien) && col !== undefined && link) lien = link(col) ?? lien; // texte affiché ≠ lien Excel
  if (!lien && col !== undefined && link) lien = link(col) ?? "";
  if (lien && !safeHttpUrl(lien)) { warnings.push("Lien Google Maps ignoré (pas une adresse http/https)"); lien = ""; }
  lien = cap(lien, 2000);

  let ville = get("ville");
  if (!ville && lien) ville = villeFromMapsUrl(lien);
  if (!ville) ville = opts.defaultVille;

  const site = get("site_web");
  if (get("email") && !isEmail(get("email"))) warnings.push(`Email ignoré (invalide) : « ${cap(get("email"), 40)} »`);
  if (site && !siteUrl(site)) warnings.push("Site web ignoré (pas une adresse web)");
  for (const k of ["facebook", "instagram"] as const) if (get(k) && !socialHref(k, normalizeSocial(k, get(k)))) warnings.push(`Lien ${k === "facebook" ? "Facebook" : "Instagram"} ignoré (invalide)`);
  return { warnings, rec: {
    nom, activite: cap(get("activite"), 300), telephone: waNumber(tel), whatsapp: waNumber(wa || tel),
    email: cap(isEmail(get("email")) ? get("email").trim().toLowerCase() : "", 200), site_web: cap(siteUrl(site), 500), adresse: cap(get("adresse"), 500), colonia: cap(get("colonia"), 200),
    ville: cap(ville, 200), fiche_google: fiche, lien_google: lien, note_google: note, nb_avis: avis, lat, lng,
    notes: cap(get("notes"), 20_000), statut, niche: cap(get("niche"), 200), specialite: cap(get("specialite"), 200), offre: cap(get("offre"), 20),
    presence_web: cap(get("presence_web"), 200), angle: cap(get("angle"), 2000), zone: cap(get("zone"), 200),
    message_whatsapp: cap(get("message_whatsapp"), MAX_CELL), motif,
    facebook: cap(socialHref("facebook", normalizeSocial("facebook", get("facebook"))), 500),
    instagram: cap(socialHref("instagram", normalizeSocial("instagram", get("instagram"))), 500),
  } };
}

// ---------- Analyse (aperçu + base du commit) ----------
export type RowStatus = "new" | "duplicate" | "internal" | "error";
export type Analyzed = {
  line: number; status: RowStatus; nom: string; rec?: Rec; error?: string; warnings: string[];
  dup?: { id: number; nom: string; reason: string }; internalOf?: number;
  /** Ligne douteuse (fichier Gemini) : pas de lien Google Maps, pas de téléphone… à vérifier avant d'importer. */
  doubts: string[];
  /** Création explicite (choix « Créer cette niche ») de la niche de ce nom. */
  newNiche?: string;
  /** Valeur d'origine de la colonne Niche et comment elle a été reconnue. */
  nicheRaw?: string; nicheHow?: NicheHow;
};

const nameKey = (nom: string, ville: string) => plain(nom).replace(/\s+/g, " ").trim() + "|" + plain(ville).replace(/\s+/g, " ").trim();

/** Index en mémoire des fiches existantes : 1 requête au lieu de 2 par ligne. */
function existingIndex() {
  const byTel = new Map<string, { id: number; nom: string }>();
  const byName = new Map<string, { id: number; nom: string }>();
  for (const b of db.prepare("SELECT id, nom, ville, tel_norm FROM businesses ORDER BY id").iterate() as Iterable<{ id: number; nom: string; ville: string; tel_norm: string }>) {
    if (b.tel_norm && !byTel.has(b.tel_norm)) byTel.set(b.tel_norm, b);
    const k = nameKey(b.nom, b.ville);
    if (!byName.has(k)) byName.set(k, b);
  }
  return { byTel, byName };
}

export type NicheHow = "exact" | "keyword" | "classe" | "choice" | "new" | "none";

/** Niche d'un texte de colonne « Niche » (avec les choix faits dans l'aperçu). */
export function nicheResolverFor(niches: NicheRow[], choices: Record<string, number | "new"> = {}) {
  const active = niches.filter((n) => !n.archived);
  const cache = new Map<string, { niche: NicheRow | null; how: NicheHow }>();
  return (raw: string): { niche: NicheRow | null; how: NicheHow } => {
    const k = foldText(raw);
    const hit = cache.get(k);
    if (hit) return hit;
    let res: { niche: NicheRow | null; how: NicheHow };
    const ch = choices[k];
    if (ch === "new") res = { niche: null, how: "new" };
    else if (typeof ch === "number") res = { niche: ch ? niches.find((n) => n.id === ch) ?? null : null, how: ch ? "choice" : "none" };
    else {
      const exact = active.find((n) => foldText(n.label) === k) ?? active.find((n) => n.keywords.includes(k));
      const kw = exact ? null : matchNicheText(raw, active);
      if (exact) res = { niche: exact, how: "exact" };
      else if (kw) res = { niche: kw, how: "keyword" };
      else {
        const c = classifyText(raw);
        const n = c.key ? nicheForMainKey(c.key, active) : null;
        res = n ? { niche: n, how: "classe" } : { niche: null, how: "none" };
      }
    }
    cache.set(k, res);
    return res;
  };
}

/** Niche active qui correspond à une niche principale (même nom ou alias). */
export function nicheForMainKey(key: string, niches: NicheRow[]): NicheRow | null {
  const d = MAIN_NICHES.find((m) => m.key === key);
  if (!d) return null;
  const names = new Set([d.label, ...(d.aliases ?? [])].map(foldText));
  return niches.find((n) => names.has(foldText(n.label))) ?? niches.find((n) => n.keywords.includes(foldText(d.label))) ?? null;
}

export function analyze(data: FileData, m: Mapping, opts: ParseOpts, niches: NicheRow[] = allNiches({ archived: true })): Analyzed[] {
  const idx = existingIndex();
  const seenTel = new Map<string, number>(), seenName = new Map<string, number>();
  const resolve = nicheResolverFor(niches, opts.nicheChoices);
  const hasMapsCol = m.lien_google_maps !== undefined;
  return data.rows.map((row, i) => {
    const line = i + 2;
    const p = parseRow(row, m, opts, (c) => data.links[`${i}:${c}`]);
    const rawNom = m.nom === undefined ? "" : (row[m.nom] ?? "").trim();
    if (!p.rec) return { line, status: "error" as const, nom: cap(rawNom, 120), error: p.error, warnings: p.warnings, doubts: [] };
    const r = p.rec;
    // Niche du fichier → niche du CRM. Jamais de création implicite : nom exact → mot-clé → classement par
    // mots-clés (niches principales) → sinon sans niche. La valeur d'origine va dans la spécialité.
    let newNiche: string | undefined, nicheRaw: string | undefined, nicheHow: NicheHow | undefined;
    if (r.niche) {
      nicheRaw = r.niche.trim();
      const res = resolve(nicheRaw);
      nicheHow = res.how;
      if (res.how === "new") newNiche = r.niche = cap(nicheRaw, 60);
      else r.niche = res.niche?.label ?? "";
      if (!r.specialite && res.how !== "new" && foldText(nicheRaw) !== foldText(r.niche)) r.specialite = cap(nicheRaw, 200);
    }
    const doubts: string[] = [];
    if (hasMapsCol && !r.lien_google) doubts.push("pas de lien Google Maps");
    if (!r.telephone && !r.whatsapp) doubts.push("pas de téléphone");
    if (r.lien_google && !/google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\./i.test(r.lien_google)) doubts.push("le lien n'est pas un lien Google Maps");
    const t = telNorm(r.telephone) || telNorm(r.whatsapp);
    const k = nameKey(r.nom, r.ville);
    const base = { line, nom: r.nom, rec: r, warnings: p.warnings, doubts, newNiche, nicheRaw, nicheHow };
    const firstLine = (t && seenTel.get(t)) || seenName.get(k);
    if (t && !seenTel.has(t)) seenTel.set(t, line);
    if (!seenName.has(k)) seenName.set(k, line);
    if (firstLine) return { ...base, status: "internal", internalOf: firstLine };
    const byTel = t ? idx.byTel.get(t) : undefined;
    const ex = byTel ?? idx.byName.get(k);
    if (ex) return { ...base, status: "duplicate", dup: { id: ex.id, nom: ex.nom, reason: byTel ? "même téléphone" : "même nom + ville" } };
    return { ...base, status: "new" };
  });
}

const tally = (items: Analyzed[], f: (r: Rec) => string) => {
  const m = new Map<string, number>();
  for (const it of items) if (it.rec && (it.status === "new" || it.status === "duplicate")) { const v = f(it.rec) || "(vide)"; m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, n]) => ({ v, n }));
};

/** Valeurs distinctes de la colonne Niche : niche reconnue (ou non) et nombre de lignes. */
function nicheValues(items: Analyzed[]) {
  const m = new Map<string, { value: string; key: string; count: number; how: NicheHow; target: string }>();
  for (const it of items) {
    if (!it.nicheRaw || !it.rec || (it.status !== "new" && it.status !== "duplicate")) continue;
    const key = foldText(it.nicheRaw);
    const x = m.get(key) ?? { value: it.nicheRaw, key, count: 0, how: it.nicheHow ?? "none", target: it.rec.niche };
    x.count++; m.set(key, x);
  }
  return [...m.values()].sort((a, b) => Number(a.how === "exact") - Number(b.how === "exact") || b.count - a.count);
}

export function summarize(items: Analyzed[]) {
  const c = (s: RowStatus) => items.filter((x) => x.status === s).length;
  return {
    total: items.length, valid: c("new"), duplicates: c("duplicate"), internal: c("internal"), errors: c("error"),
    warnings: items.filter((x) => x.warnings.length).length,
    doubts: items.filter((x) => x.status !== "error" && x.doubts.length).length,
    newNiches: [...new Set(items.filter((x) => x.newNiche && (x.status === "new" || x.status === "duplicate")).map((x) => x.newNiche!))],
    nicheValues: nicheValues(items),
    byNiche: tally(items, (r) => r.niche), byZone: tally(items, (r) => r.zone), byOffre: tally(items, (r) => r.offre), byVille: tally(items, (r) => r.ville),
  };
}

// ---------- Commit ----------
const COLS = ["nom", "activite", "telephone", "whatsapp", "tel_norm", "email", "site_web", "adresse", "colonia", "ville", "lat", "lng",
  "fiche_google", "lien_google", "note_google", "nb_avis", "source", "source_detail", "notes", "statut", "statut_date",
  "first_contact_at", "next_followup", "niche", "specialite", "offre", "presence_web", "angle", "zone", "message_whatsapp", "import_batch_id", "created_at",
  "perdu_motif", "geo_precision", "geo_source", "geo_date", "facebook", "instagram", "sources"] as const;

/** Champs complétés seulement s'ils sont vides sur la fiche existante. */
const FILL_IF_EMPTY = ["activite", "email", "site_web", "adresse", "colonia", "ville", "lien_google", "niche", "specialite", "offre",
  "presence_web", "angle", "zone", "notes", "facebook", "instagram"] as const;

/** Mise à jour d'un doublon : complète les vides, met à jour note/avis/message, n'écrase jamais un statut plus avancé ni le journal. */
function mergeInto(b: Business, r: Rec): boolean {
  const sets: Record<string, unknown> = {};
  for (const f of FILL_IF_EMPTY) if (!String(b[f] ?? "").trim() && r[f]) sets[f] = r[f];
  // Coordonnées du fichier : remplacent une position absente ou calculée (OpenStreetMap), jamais une position manuelle / DENUE.
  if (r.lat != null && r.lng != null && (b.lat == null || b.lng == null || b.geo_source === "nominatim" || !b.geo_source)) {
    if (r.lat !== b.lat || r.lng !== b.lng) Object.assign(sets, { lat: r.lat, lng: r.lng, geo_precision: "commerce", geo_source: "import", geo_date: now() });
  }
  if (!b.telephone && r.telephone) sets.telephone = r.telephone;
  if (!b.whatsapp && r.whatsapp) sets.whatsapp = r.whatsapp;
  if (!b.tel_norm && (r.telephone || r.whatsapp)) sets.tel_norm = telNorm(r.telephone) || telNorm(r.whatsapp);
  if (r.note_google !== null && r.note_google !== b.note_google) sets.note_google = r.note_google;
  if (r.nb_avis !== null && r.nb_avis !== b.nb_avis) sets.nb_avis = r.nb_avis;
  if (r.message_whatsapp && r.message_whatsapp !== b.message_whatsapp) sets.message_whatsapp = r.message_whatsapp;
  if ((b.fiche_google === "" || b.fiche_google === "verifier") && r.fiche_google && r.fiche_google !== b.fiche_google) sets.fiche_google = r.fiche_google;
  const keys = Object.keys(sets);
  if (keys.length) db.prepare(`UPDATE businesses SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => sets[k]), b.id);
  let changed = keys.length > 0;
  if ((STATUT_RANK[r.statut] ?? 0) > (STATUT_RANK[b.statut] ?? 0)) { setStatus(b.id, r.statut, r.statut === "perdu" ? r.motif || "autre" : ""); changed = true; }
  return changed;
}

export type CommitResult = { batchId: number; added: number; updated: number; ignored: number; errors: number; ms: number };

export function commit(data: FileData, m: Mapping, opts: ParseOpts & { fileName: string; format: ImportFormat; onDuplicate: "ignore" | "update" }): CommitResult {
  const t0 = performance.now();
  const items = analyze(data, m, opts);
  const t = now(), day = today();
  const source_detail = `${opts.fileName} · ${day}`;
  const ins = db.prepare(`INSERT INTO businesses(${COLS.join(",")}) VALUES(${COLS.map(() => "?").join(",")})`);
  const hist = db.prepare("INSERT INTO status_history(business_id,statut,at,day,motif) VALUES(?,?,?,?,?)");
  const client = db.prepare("INSERT OR IGNORE INTO clients(business_id, created_at) VALUES(?, ?)");
  const get = db.prepare("SELECT * FROM businesses WHERE id = ?");
  let added = 0, updated = 0, ignored = 0, errors = 0;
  const touched: number[] = [];
  const run = db.transaction(() => {
    // Niches à créer : seulement celles choisies explicitement dans l'aperçu (« Créer cette niche »)
    for (const label of new Set(items.filter((x) => x.newNiche && x.status !== "error" && x.status !== "internal").map((x) => x.newNiche!))) {
      if (!matchNicheText(label)) createNiche({ label });
    }
    const batchId = Number(db.prepare("INSERT INTO import_batches(file_name, format, created_at) VALUES(?,?,?)").run(opts.fileName, opts.format, t).lastInsertRowid);
    for (const it of items) {
      if (it.status === "error") { errors++; continue; }
      if (it.status === "internal") { ignored++; continue; }
      const r = it.rec!;
      if (it.status === "duplicate") {
        const b = get.get(it.dup!.id) as Business | undefined;
        if (opts.onDuplicate === "update" && b && mergeInto(b, r)) { updated++; addSourceTag(b.id, "excel"); touched.push(b.id); } else ignored++;
        continue;
      }
      // « Contacté » à l'import : premier contact = date d'import, relances J+2 / J+7 programmées à partir d'aujourd'hui.
      const contacted = r.statut !== "a_contacter";
      const v: Record<(typeof COLS)[number], unknown> = {
        ...r, tel_norm: telNorm(r.telephone) || telNorm(r.whatsapp), source: "Excel", source_detail,
        statut_date: t, first_contact_at: contacted ? t : null, next_followup: r.statut === "contacte" ? addDays(day, 2) : null,
        import_batch_id: batchId, created_at: t, sources: "excel",
        perdu_motif: r.statut === "perdu" ? (r.motif || "autre") : "",
        ...(r.lat != null && r.lng != null
          ? { geo_precision: "commerce", geo_source: "import", geo_date: t }
          : { geo_precision: "", geo_source: "", geo_date: null }),
      };
      const id = Number(ins.run(...COLS.map((c) => v[c])).lastInsertRowid);
      touched.push(id);
      hist.run(id, r.statut, t, day, r.statut === "perdu" ? (r.motif || "autre") : "");
      if (r.statut === "paye") client.run(id, t);
      added++;
    }
    const ms = Math.round(performance.now() - t0);
    db.prepare("UPDATE import_batches SET added=?, updated=?, ignored=?, errors=?, duration_ms=? WHERE id=?").run(added, updated, ignored, errors, ms, batchId);
    return batchId;
  });
  const batchId = run(); // exception -> ROLLBACK complet : rien n'est importé
  enqueueEnrich(touched);   // fiches avec site et sans email → enrichissement en arrière-plan
  return { batchId, added, updated, ignored, errors, ms: Math.round(performance.now() - t0) };
}

/**
 * Annule un lot : supprime les fiches CRÉÉES par ce lot qui n'ont ni action journalisée ni changement de statut depuis
 * l'import. Les autres sont conservées (et comptées). Les fiches existantes mises à jour par le lot ne sont pas modifiées.
 */
export function cancelBatch(id: number): { deleted: number; kept: number } | null {
  const batch = db.prepare("SELECT id FROM import_batches WHERE id = ?").get(id);
  if (!batch) return null;
  return db.transaction(() => {
    const deleted = db.prepare(`DELETE FROM businesses WHERE import_batch_id = ? AND statut_date = created_at
      AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.business_id = businesses.id)
      AND (SELECT COUNT(*) FROM status_history h WHERE h.business_id = businesses.id) <= 1`).run(id).changes;
    const kept = (db.prepare("SELECT COUNT(*) n FROM businesses WHERE import_batch_id = ?").get(id) as { n: number }).n;
    db.prepare("UPDATE import_batches SET cancelled_at = ?, cancelled_deleted = COALESCE(cancelled_deleted, 0) + ?, cancelled_kept = ? WHERE id = ?").run(now(), deleted, kept, id);
    return { deleted, kept };
  })();
}
