import { NextResponse } from "next/server";
import { z } from "zod";
import { checkOnGoogle, googleEnabled } from "@/lib/google";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

// Fiche > « Vérifier sur Google » (seulement si GOOGLE_PLACES_KEY est configurée).
export const POST = route(async (req) => {
  await requireSession();
  const { id } = await readJson(req, z.object({ id: zId }));
  if (!googleEnabled()) return NextResponse.json({ error: "Google Places désactivé (GOOGLE_PLACES_KEY absent)." }, { status: 400 });
  try { return NextResponse.json(await checkOnGoogle(id)); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
});
