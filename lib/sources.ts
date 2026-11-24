// Sources de leads (DENUE, OpenStreetMap, Overture…) : format commun, dédoublonnage inter-sources et fusion.
// - Dédoublonnage (le même pour toutes les sources) : identifiant de la source (CLEE / osm_id / overture_id), puis
//   téléphone normalisé, puis nom proche à moins de 100 m.
// - Ajout d'un doublon = fusion : on complète les champs vides de la fiche existante (origine enregistrée), on ajoute la
//   source à sa liste ; jamais de nouvelle fiche, jamais de changement de statut ni du drapeau « ne pas contacter ».
import { db, now, today } from "./db";
import { telNorm } from "./phone";
import { fold } from "./scian";
import { insertBusiness, getBusiness, sourcesOf, type Business } from "./crm";
import { enqueueEnrich } from "./enrich-queue";

export type SourceKey = "denue" | "osm" | "overture";
export const SOURCE_LABEL: Record<string, string> = { excel: "Excel", denue: "DENUE", osm: "OpenStreetMap", overture: "Overture", manuel: "Manuel", google: "Google" };
const ID_COL: Record<SourceKey, "denue_id" | "osm_id" | "overture_id"> = { denue: "denue_id", osm: "osm_id", overture: "overture_id" };
const SOURCE_COL: Record<SourceKey, string> = { denue: "DENUE", osm: "OSM", overture: "Overture" };

/** Établissement proposé par une source (champs vides = inconnus). */
export type Candidate = {
  source: SourceKey; sourceId: string; nom: string; categorie: string; niche: string;
  telephone: string; whatsapp?: string; email: string; site_web: string; facebook: string; instagram: string; tiktok?: string;
  adresse: string; colonia: string; ville: string; lat: number | null; lng: number | null; horaires?: string;
  /** Champs propres à DENUE */
  denue?: { num: string; alta: string; estrato: string; activite: string };
};

export type Existing = { id: number; statut: string; reason: "id" | "tel" | "nom"; dnc: boolean };

const nameKey = (s: string) => fold(s).replace(/\b(s a de c v|sa de cv|s de rl|sc|the|el|la|los|las)\b/g, "").replace(/\s+/g, " ").trim();
export function distM(a: number, b: number, c: number, d: number) {
  const R = 6371000, toR = Math.PI / 180;
  const x = (d - b) * toR * Math.cos(((a + c) / 2) * toR), y = (c - a) * toR;
  return Math.sqrt(x * x + y * y) * R;
}
/** Noms « proches » : identiques une fois normalisés, ou l'un contient l'autre (≥ 5 caractères). */
export function similarNames(a: string, b: string) {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 5 && (" " + l + " ").includes(" " + s + " ");
}

/** Index des fiches du CRM, construit une fois (1 requête) puis consulté en mémoire. */
export function existingIndex() {
  const byId = { denue: new Map<string, Existing>(), osm: new Map<string, Existing>(), overture: new Map<string, Existing>() };
  const byTel = new Map<string, Existing>();
  const geo: { e: Existing; nom: string; lat: number; lng: number }[] = [];
  type R = { id: number; statut: string; denue_id: string; osm_id: string; overture_id: string; tel_norm: string; whatsapp: string; nom: string; lat: number | null; lng: number | null; ne_pas_contacter: number };
  for (const b of db.prepare("SELECT id, statut, denue_id, osm_id, overture_id, tel_norm, whatsapp, nom, lat, lng, ne_pas_contacter FROM businesses").iterate() as Iterable<R>) {
    const e = (reason: Existing["reason"]): Existing => ({ id: b.id, statut: b.statut, reason, dnc: !!b.ne_pas_contacter });
    for (const k of ["denue", "osm", "overture"] as const) { const v = b[ID_COL[k]]; if (v && !byId[k].has(v)) byId[k].set(v, e("id")); }
    for (const t of [b.tel_norm, telNorm(b.whatsapp)]) if (t && !byTel.has(t)) byTel.set(t, e("tel"));
    if (b.lat != null && b.lng != null) geo.push({ e: e("nom"), nom: b.nom, lat: b.lat, lng: b.lng });
  }
  return (c: { source?: SourceKey; sourceId?: string; clee?: string; telephone?: string; whatsapp?: string; nom: string; lat: number | null; lng: number | null }): Existing | null => {
    const src = c.source ?? (c.clee ? "denue" : undefined), sid = c.sourceId ?? c.clee;   // lignes DENUE : identifiant = CLEE
    if (src && sid) { const x = byId[src].get(sid); if (x) return x; }
    for (const t of [telNorm(c.telephone), telNorm(c.whatsapp)]) { const x = t && byTel.get(t); if (x) return x; }
    if (c.lat != null && c.lng != null) {
      const near = geo.find((g) => Math.abs(g.lat - c.lat!) < 0.002 && Math.abs(g.lng - c.lng!) < 0.002 && distM(g.lat, g.lng, c.lat!, c.lng!) < 100 && similarNames(g.nom, c.nom));
      if (near) return near.e;
    }
    return null;
  };
}

// ---------- Origine des informations ----------
export function recordOrigin(id: number, field: string, value: string, origin: string) {
  db.prepare(`INSERT INTO field_origins(business_id, field, value, origin, at) VALUES(?,?,?,?,?)
    ON CONFLICT(business_id, field) DO UPDATE SET value=excluded.value, origin=excluded.origin, at=excluded.at`).run(id, field, value.slice(0, 500), origin.slice(0, 300), now());
}
export const originsOf = (id: number) =>
  db.prepare("SELECT field, value, origin, at FROM field_origins WHERE business_id = ? ORDER BY at DESC").all(id) as { field: string; value: string; origin: string; at: string }[];

/** Ajoute une source à la liste de la fiche (sans doublon). */
export function addSourceTag(id: number, key: string) {
  const b = db.prepare("SELECT sources FROM businesses WHERE id = ?").get(id) as { sources: string } | undefined;
  if (!b) return;
  const list = sourcesOf(b);
  if (!list.includes(key)) db.prepare("UPDATE businesses SET sources = ? WHERE id = ?").run([...list, key].join(","), id);
}

const MERGE_FIELDS = ["email", "site_web", "facebook", "instagram", "tiktok", "adresse", "colonia", "ville", "horaires", "niche"] as const;

/**
 * Fusion dans une fiche existante : seuls les champs vides sont complétés (origine notée « <source> · date »).
 * Téléphone ajouté s'il manque ; position ajoutée si la fiche n'en a pas (ou seulement une position approximative
 * OpenStreetMap / Nominatim). Statut, journal et « ne pas contacter » ne sont jamais modifiés.
 */
export function mergeInto(b: Business, c: Candidate): string[] {
  const sets: Record<string, unknown> = {};
  const filled: string[] = [];
  const origin = `${SOURCE_LABEL[c.source]} · ${today()}`;
  const fill = (k: string, v: string | undefined) => {
    if (!v || String((b as unknown as Record<string, unknown>)[k] ?? "").trim()) return;
    sets[k] = v; filled.push(k);
  };
  for (const k of MERGE_FIELDS) fill(k, (c as unknown as Record<string, string>)[k]);
  if (!b.tel_norm && telNorm(c.telephone)) { sets.telephone = c.telephone; sets.tel_norm = telNorm(c.telephone); filled.push("telephone"); }
  if (!b.whatsapp && c.whatsapp && telNorm(c.whatsapp) && telNorm(c.whatsapp) !== (b.tel_norm || telNorm(c.telephone))) { sets.whatsapp = c.whatsapp; filled.push("whatsapp"); }
  if (!b[ID_COL[c.source]] && c.sourceId) sets[ID_COL[c.source]] = c.sourceId;
  if (c.denue && !b.denue_num) Object.assign(sets, { denue_num: c.denue.num, denue_alta: b.denue_alta || c.denue.alta, denue_estrato: b.denue_estrato || c.denue.estrato });
  if (!b.activite && (c.denue?.activite || c.categorie)) { sets.activite = c.denue?.activite || c.categorie; }
  const approx = b.lat == null || (b.geo_source === "nominatim" && b.geo_precision !== "commerce" && b.geo_precision !== "adresse");
  if (c.lat != null && c.lng != null && approx) {
    Object.assign(sets, { lat: c.lat, lng: c.lng, geo_precision: "commerce", geo_source: c.source, geo_date: now() });
    db.prepare("DELETE FROM geo_queue WHERE business_id = ? AND done_at IS NULL").run(b.id);
    filled.push("position");
  }
  const keys = Object.keys(sets);
  if (keys.length) db.prepare(`UPDATE businesses SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => sets[k]), b.id);
  for (const f of filled) recordOrigin(b.id, f, String(sets[f === "position" ? "lat" : f] ?? ""), origin);
  addSourceTag(b.id, c.source);
  return filled;
}

export type AddResult = { added: number; merged: number; ids: Record<string, number>; filled: number };

/**
 * Ajoute des candidats en une transaction (tout ou rien) : nouveaux → fiche « À contacter » ; doublons (CRM ou dans
 * la sélection) → fusion. Les fiches avec site et sans email partent dans la file d'enrichissement.
 */
export function addCandidates(cands: Candidate[], label = ""): AddResult {
  const ids: Record<string, number> = {};
  let added = 0, merged = 0, filled = 0;
  const day = today(), t = now();
  const touched: number[] = [];
  db.transaction(() => {
    const find = existingIndex();
    const seen = new Map<string, number>();
    for (const c of cands) {
      const tn = telNorm(c.telephone);
      const exId = find(c)?.id ?? seen.get(c.source + ":" + c.sourceId) ?? (tn ? seen.get("t" + tn) : undefined);
      if (exId) {
        const b = getBusiness(exId);
        if (b) {
          filled += mergeInto(b, c).length; merged++; ids[c.sourceId] = exId; touched.push(exId);
          seen.set(c.source + ":" + c.sourceId, exId);
          if (tn) seen.set("t" + tn, exId);
        }
        continue;
      }
      const id = insertBusiness({
        nom: c.nom, activite: c.denue?.activite || c.categorie, telephone: c.telephone, whatsapp: c.whatsapp, email: c.email, site_web: c.site_web,
        facebook: c.facebook, instagram: c.instagram, tiktok: c.tiktok, adresse: c.adresse, colonia: c.colonia, zone: c.colonia,
        ville: c.ville, lat: c.lat, lng: c.lng, niche: c.niche, horaires: c.horaires, source: SOURCE_COL[c.source],
        source_detail: `${SOURCE_LABEL[c.source]} · ${day}${label ? " · " + label.slice(0, 80) : ""}`,
        [ID_COL[c.source]]: c.sourceId, sources: c.source,
        ...(c.denue ? { denue_num: c.denue.num, denue_alta: c.denue.alta, denue_estrato: c.denue.estrato, denue_sync: t } : {}),
      });
      for (const f of ["email", "site_web", "facebook", "instagram", "telephone"] as const) if (c[f]) recordOrigin(id, f, c[f]!, `${SOURCE_LABEL[c.source]} · ${day}`);
      ids[c.sourceId] = id; seen.set(c.source + ":" + c.sourceId, id);
      if (tn) seen.set("t" + tn, id);
      touched.push(id);
      added++;
    }
    if (cands.some((c) => c.source === "denue")) {
      const st = db.prepare("UPDATE denue_seen SET is_new = 0 WHERE clee = ?");
      for (const c of cands) if (c.source === "denue") st.run(c.sourceId);
    }
  })();
  enqueueEnrich(touched);
  return { added, merged, ids, filled };
}
