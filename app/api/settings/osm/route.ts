import { NextResponse } from "next/server";
import { z } from "zod";
import { osmInstances, saveOsmInstances, validInstance, DEFAULT_INSTANCES } from "@/lib/osm";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

// Réglages > Sources & clés : instances Overpass (OpenStreetMap), dans l'ordre d'essai.
export const GET = route(async () => {
  await requireSession();
  return NextResponse.json({ instances: osmInstances(), defaults: DEFAULT_INSTANCES, env: !!process.env.OVERPASS_URL });
});
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, z.object({ instances: z.array(z.string().trim().refine(validInstance, "adresse https://…/api/interpreter attendue")).min(1).max(8).optional(), reset: z.boolean().optional() }));
  saveOsmInstances(b.reset || !b.instances ? DEFAULT_INSTANCES : b.instances);
  return NextResponse.json({ instances: osmInstances(), defaults: DEFAULT_INSTANCES, env: !!process.env.OVERPASS_URL });
});
