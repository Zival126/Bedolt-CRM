import { NextResponse } from "next/server";
import { market } from "@/lib/denue-watch";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

// Tableau « Marché » : mes niches × municipios (Cuantificar, en cache 24 h) vs fiches du CRM.
export const GET = route(async (req) => {
  await requireSession();
  const e = new URL(req.url).searchParams.get("estrato") ?? "0";
  return NextResponse.json(await market(/^\d$/.test(e) ? e : "0"));
});
