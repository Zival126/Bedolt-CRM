import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ObjectivesSchema, saveObjectives } from "@/lib/settings";
import { matchingNew } from "@/lib/queue-count";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

// Réglages > Objectifs : quotas du jour, limite dure WhatsApp (blocage serveur), filtre et ordre de la file.
// Un changement de filtre / d'ordre reconstruit les « nouveaux » non traités de la file du jour (lib/queue.ts).
export const POST = route(async (req) => {
  await requireSession();
  const o = await readJson(req, ObjectivesSchema);
  saveObjectives(o);
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, matching: matchingNew(o) });
});
