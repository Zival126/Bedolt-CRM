import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { QueueFilterSchema } from "@/lib/settings";
import { setDayFilter } from "@/lib/queue-count";
import { pickForToday, dayObjectives } from "@/lib/queue";
import { matchingNew } from "@/lib/queue-count";
import { idsForFilter } from "@/lib/crm";
import { readFilters, readMapFilters } from "@/lib/filters";
import { withQueue } from "@/lib/queue";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.discriminatedUnion("action", [
  // Filtre « Ma journée » (remplace celui de Réglages pour aujourd'hui) ; reset = revenir aux réglages par défaut
  z.object({ action: z.literal("filter"), filter: QueueFilterSchema, relances: z.boolean().default(false) }),
  z.object({ action: z.literal("reset") }),
  // « Ajouter à ma journée » : fiches choisies (ids) ou toutes celles d'un filtre de Commerces / de la Carte
  z.object({ action: z.literal("pick"), ids: z.array(zId).max(500).optional(), query: z.string().max(4000).optional(), from: z.enum(["commerces", "carte"]).default("commerces") })
    .refine((v) => !!v.ids !== (v.query !== undefined), "ids ou query"),
]);

export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  if (b.action === "pick") {
    const sp = Object.fromEntries(new URLSearchParams(b.query ?? ""));
    const ids = b.ids ?? idsForFilter(withQueue(b.from === "carte" ? { ...readMapFilters(sp), sort: "offre" } : readFilters(sp).f), 500);
    const r = pickForToday(ids);
    revalidatePath("/", "layout");
    return NextResponse.json(r);
  }
  setDayFilter(b.action === "reset" ? null : { filter: b.filter, relances: b.relances });
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, matching: matchingNew(dayObjectives()) });
});
