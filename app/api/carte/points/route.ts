import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { whereOf, nicheFacet } from "@/lib/crm";
import { readMapFilters } from "@/lib/filters";
import { withQueue } from "@/lib/queue";
import { STATUTS } from "@/lib/constants";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const MAX_POINTS = 20_000;
const STAT = STATUTS.map((s) => s.key) as string[];
const PREC = ["commerce", "adresse", "zone", "ville"];

/**
 * Points de la carte pour les filtres actifs (mêmes paramètres d'URL que Commerces, relus et bornés par
 * readMapFilters) : seulement les champs utiles, en tableaux compacts. Les détails sont chargés au clic (/api/carte/fiche).
 * Ligne : [id, lat, lng, n° statut, n° précision, nom, niche, offre, id de niche (0 = sans)]
 * `facet` : fiches par niche avec les autres filtres (puces de niches), hors filtre de niche.
 */
export const GET = route(async (req) => {
  await requireSession();
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const f = withQueue(readMapFilters(sp));
  const w = whereOf(f);
  const and = w.sql ? w.sql + " AND" : "WHERE";
  const rows = db.prepare(`SELECT id, lat, lng, statut, geo_precision p, nom, COALESCE(NULLIF(niche,''), activite) niche, offre, COALESCE(niche_id, 0) nid
    FROM businesses ${and} lat IS NOT NULL AND lng IS NOT NULL LIMIT ${MAX_POINTS}`).raw().all(...w.args) as [number, number, number, string, string, string, string, string, number][];
  const c = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN lat IS NULL OR lng IS NULL THEN 1 ELSE 0 END) missing FROM businesses ${w.sql}`).get(...w.args) as { n: number; missing: number | null };
  const points = rows.map(([id, lat, lng, s, p, nom, niche, offre, nid]) =>
    [id, lat, lng, Math.max(0, STAT.indexOf(s === "pas_interesse" ? "perdu" : s)), Math.max(0, PREC.indexOf(p || "commerce")), nom.slice(0, 120), (niche ?? "").slice(0, 60), offre ?? "", nid]);
  return NextResponse.json({ statuts: STAT, precisions: PREC, points, total: c.n, missing: c.missing ?? 0, truncated: rows.length >= MAX_POINTS, facet: Object.fromEntries(nicheFacet(f)) },
    { headers: { "Cache-Control": "no-store" } });
});
