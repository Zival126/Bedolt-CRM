import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { enqueueAi, useAiOutput, clearAiQueue } from "@/lib/ai-context";
import { aiWorkerStatus, kickAi } from "@/lib/ai-prepare";
import { idsForFilter } from "@/lib/crm";
import { readFilters } from "@/lib/filters";
import { withQueue, todayQueueIds } from "@/lib/queue";
import { readJson, route, zId } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

const Body = z.discriminatedUnion("action", [
  // « Préparer avec l'IA » : fiches choisies, toutes celles d'un filtre de Commerces, ou la file du jour ; regen = « Régénérer »
  z.object({ action: z.literal("prepare"), ids: z.array(zId).max(2000).optional(), query: z.string().max(4000).optional(), today: z.boolean().optional(), regen: z.boolean().optional() }),
  // Validation humaine d'une proposition : « Utiliser ce message » ou « Ignorer »
  z.object({ action: z.literal("use"), id: zId }), z.object({ action: z.literal("dismiss"), id: zId }),
  z.object({ action: z.literal("clear") }),
]);

export const dynamic = "force-dynamic";
export const GET = route(async () => { await requireSession(); return NextResponse.json(aiWorkerStatus(), { headers: { "Cache-Control": "no-store" } }); });
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  if (b.action === "use" || b.action === "dismiss") {
    if (!useAiOutput(b.id, b.action)) throw new HttpError(400, "Aucune proposition de l'IA à appliquer pour cette fiche.");
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true });
  }
  if (b.action === "clear") { const removed = clearAiQueue(); revalidatePath("/", "layout"); return NextResponse.json({ removed, status: aiWorkerStatus() }); }
  const ids = b.today ? todayQueueIds() : b.ids ?? idsForFilter(withQueue(readFilters(Object.fromEntries(new URLSearchParams(b.query ?? ""))).f), 2000);
  const added = enqueueAi(ids, { regen: b.regen });
  kickAi();
  revalidatePath("/", "layout");
  return NextResponse.json({ added, skipped: new Set(ids).size - added, status: aiWorkerStatus() });
});
