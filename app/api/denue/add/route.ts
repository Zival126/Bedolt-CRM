import { NextResponse } from "next/server";
import { insertBusiness, findDuplicate } from "@/lib/crm";
import type { DenueRow } from "@/lib/denue";

type Item = DenueRow & { fiche_google?: string; interet?: string; note?: string };

export async function POST(req: Request) {
  const { items } = (await req.json()) as { items: Item[] };
  let added = 0, skipped = 0;
  const ids: Record<string, number> = {};
  for (const r of items) {
    const existing = findDuplicate({ denue_id: r.clee, telephone: r.telephone });
    if (existing) { skipped++; ids[r.clee] = existing.id; continue; }
    ids[r.clee] = insertBusiness({
      nom: r.nom, activite: r.activite, telephone: r.telephone, email: r.email, site_web: r.site_web,
      adresse: r.adresse, colonia: r.colonia, ville: r.ville, lat: r.lat, lng: r.lng,
      fiche_google: r.fiche_google ?? "", interet: r.interet ?? "", notes: r.note ?? "",
      source: "DENUE", denue_id: r.clee,
    });
    added++;
  }
  return NextResponse.json({ added, skipped, ids });
}
