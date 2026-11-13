import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { complete } from "@/lib/ai";
import { criteria } from "@/lib/settings";
import { getBusiness } from "@/lib/crm";
import { revalidatePath } from "next/cache";

export const maxDuration = 300;

// Classement IA d'une sélection : score 0-100 + raison courte, par lots de 8.
export async function POST(req: Request) {
  const { ids } = (await req.json()) as { ids: number[] };
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
      const parsed = m ? JSON.parse(m[0]) : {};
      const list: { id: number; score: number; raison: string }[] = parsed.resultats ?? parsed.results ?? [];
      for (const r of list) {
        if (!batch.some((b) => b.id === Number(r.id))) continue;
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
}
