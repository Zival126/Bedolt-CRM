import { NextResponse } from "next/server";
import { z } from "zod";
import { searchOverture, overtureMeta, overtureCount, overtureCategories } from "@/lib/overture";
import { municipioBbox } from "@/lib/geo-qroo";
import { existingIndex } from "@/lib/sources";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({
  categories: z.array(z.string().regex(/^[a-z0-9_]{2,80}$/)).max(80).default([]),
  niche: z.string().max(100).optional(),
  bbox: z.object({ s: z.number(), w: z.number(), n: z.number(), e: z.number() }).optional(),
  municipio: z.string().regex(/^\d{3}$/).optional(),
  q: z.string().trim().max(100).optional(),
  tel: z.boolean().optional(), site: z.boolean().optional(), social: z.boolean().optional(), email: z.boolean().optional(),
  minConfidence: z.number().min(0).max(1).optional(), excludeClosed: z.boolean().default(true),
});

// Overture : recherche dans la table locale (aucune requête réseau).
export const GET = route(async () => {
  await requireSession();
  return NextResponse.json({ meta: overtureMeta(), count: overtureCount(), categories: overtureCategories() });
});
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  const bbox = b.bbox ?? (b.municipio ? municipioBbox(b.municipio) ?? undefined : undefined);
  const r = searchOverture({ ...b, bbox });
  const find = existingIndex();
  return NextResponse.json({ total: r.total, rows: r.candidates.map((c) => ({ ...c, existing: find(c) })) });
});
