import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueue, geoStatus } from "@/lib/geocode";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({ scope: z.literal("missing") }).strict();

// « Géolocaliser les fiches sans position » : ajoute à la file persistante ; le worker serveur s'en charge (1 req/s).
export const POST = route(async (req) => {
  await requireSession();
  await readJson(req, Body);
  const added = enqueue();
  return NextResponse.json({ added, status: geoStatus() });
});
