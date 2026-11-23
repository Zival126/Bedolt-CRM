import { NextResponse } from "next/server";
import { searchScian, catalog } from "@/lib/scian";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

// Catalogue SCIAN 2023 (INEGI) : recherche par mot-clé (espagnol ou français) ou par début de code.
export const GET = route(async (req) => {
  await requireSession();
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  const c = catalog();
  return NextResponse.json({ hits: searchScian(q, 40), source: c._source, date: c._date });
});
