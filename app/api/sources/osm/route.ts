import { NextResponse } from "next/server";
import { z } from "zod";
import { searchOsm, validTag, OsmError } from "@/lib/osm";
import { localidadBbox } from "@/lib/geo-qroo";
import { existingIndex } from "@/lib/sources";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({
  tags: z.array(z.string().refine(validTag, "catégorie OSM invalide (clé=valeur)")).min(1).max(30),
  bbox: z.object({ s: z.number(), w: z.number(), n: z.number(), e: z.number() }).optional(),
  ville: z.string().regex(/^\d{7}$/).optional(),          // localidad : municipio (3) + localidad (4)
}).refine((b) => !!b.bbox !== !!b.ville, "zone : bbox OU ville");

// OpenStreetMap (Overpass) : établissements des catégories choisies dans la zone ; badge « déjà dans le CRM ».
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  const bbox = b.bbox ?? localidadBbox(b.ville!.slice(0, 3), b.ville!.slice(3));
  if (!bbox) return NextResponse.json({ error: "Ville inconnue." }, { status: 400 });
  try {
    const r = await searchOsm(b.tags, bbox);
    const find = existingIndex();
    return NextResponse.json({ ...r, bbox, candidates: undefined, rows: r.candidates.map((c) => ({ ...c, existing: find(c) })) });
  } catch (e) {
    if (e instanceof OsmError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
});
