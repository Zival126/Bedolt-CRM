import { NextResponse } from "next/server";
import { searchZones } from "@/lib/geo-mx";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

// Recherche de zone (État, municipio, ville) dans le catalogue INEGI : accents / majuscules ignorés, synonymes.
export const GET = route(async (req) => {
  await requireSession();
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
  return NextResponse.json({ hits: searchZones(q, 12) }, { headers: { "Cache-Control": "private, max-age=300" } });
});
