import { NextResponse } from "next/server";
import { z } from "zod";
import { niches, saveNiches, NichesSchema, defaultNiches } from "@/lib/niches";
import { scianTitle } from "@/lib/scian";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const withTitles = () => niches().map((n) => ({ ...n, titles: n.codes.map((c) => scianTitle(c)) }));

export const GET = route(async () => {
  await requireSession();
  return NextResponse.json({ niches: withTitles() });
});
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, z.object({ niches: NichesSchema.optional(), reset: z.boolean().optional() }));
  saveNiches(b.reset ? defaultNiches() : b.niches ?? []);
  return NextResponse.json({ niches: withTitles() });
});
