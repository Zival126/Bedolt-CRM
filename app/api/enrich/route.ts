import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueEnrich, enrichStatus, enrichBusiness, enricherRunning } from "@/lib/enrich";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("all") }),                      // « Enrichir les fiches » : toutes les éligibles
  z.object({ action: z.literal("one"), id: zId }),              // fiche : « Enrichir maintenant » (même si déjà fait)
]);

export const GET = route(async () => {
  await requireSession();
  return NextResponse.json(enrichStatus(enricherRunning()), { headers: { "Cache-Control": "no-store" } });
});
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  if (b.action === "all") return NextResponse.json({ added: enqueueEnrich(), status: enrichStatus(enricherRunning()) });
  const o = await enrichBusiness(b.id);
  return NextResponse.json(o);
});
