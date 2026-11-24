import { NextResponse } from "next/server";
import { db, today } from "@/lib/db";
import { totalNew } from "@/lib/denue-watch";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Compteurs de la navigation : réponses à traiter aujourd'hui, nouveaux établissements DENUE (veille).
export const GET = route(async () => {
  await requireSession();
  const reponses = (db.prepare(`SELECT COUNT(*) n FROM businesses WHERE ne_pas_contacter = 0 AND ((statut = 'a_repondu' AND (next_date IS NULL OR next_date <= ?))
    OR (statut = 'interesse' AND next_date IS NOT NULL AND next_date <= ?))`).get(today(), today()) as { n: number }).n;
  return NextResponse.json({ reponses, denue: totalNew() }, { headers: { "Cache-Control": "no-store" } });
});
