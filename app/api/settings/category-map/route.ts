import { NextResponse } from "next/server";
import { z } from "zod";
import { mappingTable, setMapping } from "@/lib/category-map";
import { niches } from "@/lib/niches";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Src = z.enum(["osm", "overture"]);
const Body = z.object({
  source: Src,
  category: z.string().trim().regex(/^([a-z_]+=[a-z0-9_;:-]+|[a-z0-9_]{2,80})$/, "catégorie invalide"),
  niche: z.string().trim().max(100).nullable(),     // null = revenir à la règle par défaut ; '' = ignorer
});

// Réglages > Sources : correspondance catégorie OSM / Overture → niche.
export const GET = route(async (req) => {
  await requireSession();
  const source = Src.parse(new URL(req.url).searchParams.get("source") ?? "osm");
  return NextResponse.json({ rows: mappingTable(source), niches: niches().map((n) => n.label) });
});
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  setMapping(b.source, b.category, b.niche);
  return NextResponse.json({ rows: mappingTable(b.source) });
});
