import { NextResponse } from "next/server";
import { z } from "zod";
import { favoris, saveFavoris, defaultFavoris, FavorisSchema, zoneLabel } from "@/lib/geo-mx";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const withLabels = () => favoris().map((f) => ({ ...f, full: zoneLabel(f) }));

// Zones favorites (puces au-dessus du choix de zone), modifiables dans Réglages.
export const GET = route(async () => {
  await requireSession();
  return NextResponse.json({ favoris: withLabels() });
});
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, z.object({ favoris: FavorisSchema.optional(), reset: z.boolean().optional() }));
  saveFavoris(b.reset ? defaultFavoris() : b.favoris ?? []);
  return NextResponse.json({ favoris: withLabels() });
});
