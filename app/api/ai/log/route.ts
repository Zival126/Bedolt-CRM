import { NextResponse } from "next/server";
import { aiCalls } from "@/lib/llm";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";
export const dynamic = "force-dynamic";
// Journal des appels IA (100 derniers) : date, tâche, fiche, durée, tokens, erreur. Ni contenu ni secret.
export const GET = route(async () => {
  await requireSession();
  return NextResponse.json({ calls: aiCalls(100) }, { headers: { "Cache-Control": "no-store" } });
});
