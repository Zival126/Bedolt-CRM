import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { enqueueAi, aiQueueStatus, useAiOutput } from "@/lib/ai-context";
import { idsForFilter } from "@/lib/crm";
import { readFilters } from "@/lib/filters";
import { withQueue, todayQueueIds } from "@/lib/queue";
import { readJson, route, zId } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

const Body = z.discriminatedUnion("action", [
  // « Préparer avec l'IA » : fiches choisies, toutes celles d'un filtre de Commerces, ou la file du jour
  z.object({ action: z.literal("prepare"), ids: z.array(zId).max(2000).optional(), query: z.string().max(4000).optional(), today: z.boolean().optional() }),
  // Validation humaine d'une proposition : « Utiliser ce message » ou « Ignorer »
  z.object({ action: z.literal("use"), id: zId }), z.object({ action: z.literal("dismiss"), id: zId }),
]);

export const GET = route(async () => { await requireSession(); return NextResponse.json(aiQueueStatus()); });
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  if (b.action === "use" || b.action === "dismiss") {
    if (!useAiOutput(b.id, b.action)) throw new HttpError(400, "Aucune proposition de l'IA à appliquer pour cette fiche.");
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true });
  }
  const ids = b.today ? todayQueueIds() : b.ids ?? idsForFilter(withQueue(readFilters(Object.fromEntries(new URLSearchParams(b.query ?? ""))).f), 2000);
  const added = enqueueAi(ids);
  revalidatePath("/", "layout");
  return NextResponse.json({ added, status: aiQueueStatus() });
});
