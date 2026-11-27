import { NextResponse } from "next/server";
import { db, today } from "@/lib/db";
import { totalNew } from "@/lib/denue-watch";
import { aiStatus } from "@/lib/llm";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Compteurs de la navigation : réponses à traiter aujourd'hui, nouveaux établissements DENUE (veille), IA en ligne.
export const GET = route(async () => {
  await requireSession();
  const reponses = (db.prepare(`SELECT COUNT(*) n FROM businesses WHERE ne_pas_contacter = 0 AND ((statut = 'a_repondu' AND (next_date IS NULL OR next_date <= ?))
    OR (statut = 'interesse' AND next_date IS NOT NULL AND next_date <= ?))`).get(today(), today()) as { n: number }).n;
  // État de l'IA : dernière valeur connue tout de suite (rafraîchie en arrière-plan toutes les 60 s)
  const ai = await aiStatus({ stale: true }).catch(() => null);
  return NextResponse.json({ reponses, denue: totalNew(), ai: ai && { online: ai.online, configured: ai.configured, message: ai.message } }, { headers: { "Cache-Control": "no-store" } });
});
