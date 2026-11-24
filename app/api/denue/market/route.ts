import { NextResponse } from "next/server";
import { market } from "@/lib/denue-watch";
import { entidad } from "@/lib/geo-mx";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

// Tableau « Marché » : mes niches × municipios (Cuantificar, en cache 24 h) vs fiches du CRM.
export const GET = route(async (req) => {
  await requireSession();
  const sp = new URL(req.url).searchParams;
  const e = sp.get("estrato") ?? "0", ent = sp.get("entidad") ?? "23", par = sp.get("par") === "etat" ? "etat" : "municipio";
  if (!/^\d{2}$/.test(ent) || !entidad(ent)) return NextResponse.json({ error: "État inconnu." }, { status: 400 });
  return NextResponse.json(await market(/^\d$/.test(e) ? e : "0", ent, par));
});
