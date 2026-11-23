import { NextResponse } from "next/server";
import { z } from "zod";
import { skipItem } from "@/lib/queue";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({ qid: zId });

// « Passer » (mode focus) : l'élément repart en fin de file, rien n'est journalisé.
export const POST = route(async (req) => {
  await requireSession();
  const { qid } = await readJson(req, Body);
  if (!skipItem(qid)) return NextResponse.json({ error: "Élément introuvable dans la file du jour." }, { status: 404 });
  return NextResponse.json({ ok: true });
});
