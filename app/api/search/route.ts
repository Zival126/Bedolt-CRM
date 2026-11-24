import { NextResponse } from "next/server";
import { z } from "zod";
import { quickSearch } from "@/lib/crm";
import { nicheList } from "@/lib/niches";
import { prettyPhone } from "@/lib/phone";
import { parse, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Recherche globale (nom ou téléphone) : 8 fiches au plus.
export const GET = route(async (req) => {
  await requireSession();
  const q = parse(z.string().trim().min(2).max(100), new URL(req.url).searchParams.get("q") ?? "");
  const niches = new Map(nicheList().map((n) => [n.id, n]));
  const rows = quickSearch(q).map((r) => ({ id: r.id, nom: r.nom, ville: r.ville, statut: r.statut, tel: r.tel_norm ? prettyPhone(r.tel_norm) : "", niche: r.niche_id ? niches.get(r.niche_id) ?? null : null }));
  return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
});
