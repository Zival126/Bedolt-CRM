import { NextResponse } from "next/server";
import { z } from "zod";
import { searchOsm, validTag, OsmError, type OsmEvent } from "@/lib/osm";
import { localidadBbox } from "@/lib/geo-qroo";
import { existingIndex } from "@/lib/sources";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({
  tags: z.array(z.string().refine(validTag, "catégorie OSM invalide (clé=valeur)")).min(1).max(30),
  bbox: z.object({ s: z.number(), w: z.number(), n: z.number(), e: z.number() }).optional(),
  ville: z.string().regex(/^\d{7}$/).optional(),          // localidad : municipio (3) + localidad (4)
  prefer: z.number().int().min(0).max(10).optional(),     // « Réessayer avec un autre serveur »
}).refine((b) => !!b.bbox !== !!b.ville, "zone : bbox OU ville");

// OpenStreetMap (Overpass) : réponse en flux NDJSON (tuiles, attentes « serveurs saturés »), puis les résultats avec
// le badge « déjà dans le CRM ».
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  const bbox = b.bbox ?? localidadBbox(b.ville!.slice(0, 3), b.ville!.slice(3));
  if (!bbox) return NextResponse.json({ error: "Ville inconnue : choisis-en une autre ou utilise la zone de la carte." }, { status: 400 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      const send = (o: object) => { try { ctl.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { /* client parti */ } };
      try {
        const r = await searchOsm(b.tags, bbox, { prefer: b.prefer, onEvent: (e: OsmEvent) => send(e) });
        const find = existingIndex();
        send({ type: "done", ...r, bbox, candidates: undefined, rows: r.candidates.map((c) => ({ ...c, existing: find(c) })) });
      } catch (e) {
        send({ type: "error", error: e instanceof OsmError ? e.message : "Erreur inattendue pendant la recherche OpenStreetMap.", retryable: e instanceof OsmError ? e.retryable : true });
        if (!(e instanceof OsmError)) console.error("[bedolt-crm] OSM", e);
      }
      ctl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
});
