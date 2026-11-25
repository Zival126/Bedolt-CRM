import { NextResponse } from "next/server";
import { getAiContext, AI_CONTEXT_SCHEMA } from "@/lib/ai-context";
import { parse, route, zId } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Dossier IA d'une fiche (JSON stable) ; ?schema=1 : description des champs. Lecture seule, session obligatoire.
export const GET = route(async (req) => {
  await requireSession();
  const sp = new URL(req.url).searchParams;
  if (sp.get("schema") === "1") return NextResponse.json(AI_CONTEXT_SCHEMA);
  const ctx = getAiContext(parse(zId, sp.get("id")));
  if (!ctx) throw new HttpError(404, "Commerce introuvable.");
  return NextResponse.json(ctx, { headers: { "Cache-Control": "no-store" } });
});
