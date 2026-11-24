// État et municipio des fiches (colonnes etat / etat_code / municipio / municipio_code, schéma v7).
// Ordre : codes déjà fournis (DENUE) → CLEE DENUE (2 chiffres d'État + 3 de municipio) → position → nom de la ville.
import { db } from "./db";
import { inferZone, entidad, municipio } from "./geo-mx";

type Row = { id: number; denue_id: string; lat: number | null; lng: number | null; ville: string; etat_code: string; municipio_code: string };

export function zoneFor(b: Omit<Row, "id">): { etat_code: string; municipio_code: string } | null {
  if (b.etat_code && b.municipio_code) return { etat_code: b.etat_code, municipio_code: b.municipio_code };
  const clee = (b.denue_id ?? "").trim();
  if (/^\d{5}/.test(clee) && municipio(clee.slice(0, 2), clee.slice(2, 5)) && (!b.etat_code || b.etat_code === clee.slice(0, 2)))
    return { etat_code: clee.slice(0, 2), municipio_code: clee.slice(2, 5) };
  const z = inferZone({ lat: b.lat, lng: b.lng, ville: b.ville, etat_code: b.etat_code });
  if (z && (!b.etat_code || z.ent === b.etat_code)) return { etat_code: z.ent, municipio_code: z.mun };
  return b.etat_code ? { etat_code: b.etat_code, municipio_code: "" } : null;
}

/** Complète une fiche (après création ou modification de la ville / position). */
export function fillZone(id: number): boolean {
  const b = db.prepare("SELECT id, denue_id, lat, lng, ville, etat_code, municipio_code FROM businesses WHERE id = ?").get(id) as Row | undefined;
  if (!b) return false;
  const named = db.prepare("SELECT etat, municipio FROM businesses WHERE id = ?").get(id) as { etat: string; municipio: string };
  if (b.etat_code && b.municipio_code && named.etat && named.municipio) return false;
  const z = zoneFor(b);
  if (!z) return false;
  const changed = z.etat_code !== b.etat_code || z.municipio_code !== b.municipio_code || !named.etat;
  if (!changed) return false;
  return db.prepare("UPDATE businesses SET etat_code = ?, etat = ?, municipio_code = ?, municipio = ? WHERE id = ?")
    .run(z.etat_code, entidad(z.etat_code)?.n ?? "", z.municipio_code, z.municipio_code ? municipio(z.etat_code, z.municipio_code)?.n ?? "" : "", id).changes > 0;
}

/** Démarrage : fiches sans municipio (anciennes fiches du Quintana Roo après la migration v7). Idempotent. */
export function backfillZones(): number {
  const rows = db.prepare("SELECT id FROM businesses WHERE COALESCE(municipio_code, '') = '' LIMIT 50000").all() as { id: number }[];
  let n = 0;
  db.transaction(() => { for (const r of rows) if (fillZone(r.id)) n++; })();
  return n;
}
