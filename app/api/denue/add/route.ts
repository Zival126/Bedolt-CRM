import { NextResponse } from "next/server";
import { z } from "zod";
import { insertBusiness, findDuplicate } from "@/lib/crm";
import { readJson, route, zText } from "@/lib/api";
import { requireSession } from "@/lib/session";

const coord = (min: number, max: number) => z.number().min(min).max(max).nullable().default(null);
const Item = z.object({
  clee: z.string().min(1).max(100), nom: z.string().trim().min(1).max(300), activite: zText(300), telephone: zText(50),
  email: zText(200), site_web: zText(500), adresse: zText(500), colonia: zText(200), ville: zText(200),
  lat: coord(-90, 90), lng: coord(-180, 180),
  fiche_google: z.enum(["", "oui", "non", "vide", "verifier"]).default(""),
  interet: z.enum(["", "chaud", "tiede", "froid"]).default(""), note: zText(2000),
});
const Body = z.object({ items: z.array(Item).min(1).max(500) });

export const POST = route(async (req) => {
  await requireSession();
  const { items } = await readJson(req, Body);
  let added = 0, skipped = 0;
  const ids: Record<string, number> = {};
  for (const r of items) {
    const existing = findDuplicate({ denue_id: r.clee, telephone: r.telephone });
    if (existing) { skipped++; ids[r.clee] = existing.id; continue; }
    ids[r.clee] = insertBusiness({
      nom: r.nom, activite: r.activite, telephone: r.telephone, email: r.email, site_web: r.site_web,
      adresse: r.adresse, colonia: r.colonia, ville: r.ville, lat: r.lat, lng: r.lng,
      fiche_google: r.fiche_google, interet: r.interet, notes: r.note,
      source: "DENUE", denue_id: r.clee,
    });
    added++;
  }
  return NextResponse.json({ added, skipped, ids });
});
