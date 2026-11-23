import { NextResponse } from "next/server";
import { geoStatus } from "@/lib/geocode";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Progression du géocodage (« 340 / 1000 ») et nombre de fiches sans position.
export const GET = route(async () => {
  await requireSession();
  return NextResponse.json(geoStatus(), { headers: { "Cache-Control": "no-store" } });
});
