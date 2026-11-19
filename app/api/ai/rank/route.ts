import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { complete } from "@/lib/ai";
import { criteria } from "@/lib/settings";
import { getBusiness } from "@/lib/crm";
import { revalidatePath } from "next/cache";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

export const maxDuration = 300;
const Body = z.object({ ids: z.array(zId).min(1).max(1000) });

// Classement IA d'une sélection : score 0-100 + raison courte, par lots de 8.
export const POST = route(async (req) => {
  await requireSession();
  const { ids } = await readJson(req, Body);
  const system = "Tu classes des prospects commerciaux par priorité pour une agence qui crée des fiches Google et sites web. " +
    "Critères de l'agence : " + criteria() +
    '\nRéponds UNIQUEMENT en JSON : {"resultats":[{"id":number,"score":0-100,"raison":"phrase courte en français"}]}';
  let done = 0;
  try {
    for (let i = 0; i < ids.length; i += 8) {
      const batch = ids.slice(i, i + 8).map(getBusiness).filter(Boolean) as NonNullable<ReturnType<typeof getBusiness>>[];
      const data = batch.map((b) => ({ id: b.id, nom: b.nom, activite: b.activite, ville: b.ville, fiche_google: b.fiche_google || "inconnu",
        note_google: b.note_google, nb_avis: b.nb_avis, a_telephone: !!b.tel_norm, site_web: !!b.site_web, interet: b.interet || "inconnu", notes: b.notes }));
      const raw = await complete(system, JSON.stringify(data), true);
      const m = raw.match(/\{[\s\S]*\}/);
      let parsed: { resultats?: unknown; results?: unknown } = {};
      try { parsed = m ? JSON.parse(m[0]) : {}; } catch { continue; } // lot illisible : on passe au suivant
      const list = (Array.isArray(parsed.resultats) ? parsed.resultats : Array.isArray(parsed.results) ? parsed.results : []) as { id: number; score: number; raison: string }[];
      for (const r of list) {
        if (!r || !batch.some((b) => b.id === Number(r.id))) continue;
        const score = Math.max(0, Math.min(100, Math.round(Number(r.score))));
        if (Number.isNaN(score)) continue;
        db.prepare("UPDATE businesses SET score=?, score_raison=? WHERE id=?").run(score, String(r.raison ?? "").slice(0, 300), Number(r.id));
        done++;
      }
    }
  } catch (e) {
    revalidatePath("/", "layout");
    return NextResponse.json({ error: (e as Error).message, done }, { status: 502 });
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ done, total: ids.length });
});
