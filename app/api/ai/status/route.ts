import { NextResponse } from "next/server";
import { aiStatus } from "@/lib/llm";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";
export const dynamic = "force-dynamic";
// « IA en ligne / hors ligne » (cache 60 s ; ?fresh=1 : nouveau test, ex. après « Enregistrer »).
export const GET = route(async (req) => {
  await requireSession();
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  return NextResponse.json(await aiStatus({ fresh }), { headers: { "Cache-Control": "no-store" } });
});
