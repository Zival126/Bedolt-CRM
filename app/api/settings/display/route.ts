import { NextResponse } from "next/server";
import { z } from "zod";
import { setSetting, mapColorMode } from "@/lib/settings";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

// Réglages > Affichage : couleur des points de la carte (niche ou statut).
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, z.object({ mapColor: z.enum(["niche", "statut"]) }));
  setSetting("map_color", b.mapColor);
  return NextResponse.json({ mapColor: mapColorMode() });
});
