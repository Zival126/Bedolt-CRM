import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { allNiches, createNiche, updateNiche, setNicheMaps, mergeNiches, assignNiche, nicheStats, NicheInput, NicheError, MAP_KINDS } from "@/lib/niches";
import { autoAssign } from "@/lib/category-map";
import { idsForFilter } from "@/lib/crm";
import { readFilters } from "@/lib/filters";
import { withQueue } from "@/lib/queue";
import { readJson, route, zId } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), niche: NicheInput }),
  z.object({ action: z.literal("update"), id: zId, niche: NicheInput.partial(), archived: z.boolean().optional() }),
  z.object({ action: z.literal("maps"), id: zId, kind: z.enum(MAP_KINDS as [string, ...string[]]), values: z.array(z.string().max(100)).max(300) }),
  z.object({ action: z.literal("merge"), from: zId, into: zId }),
  z.object({ action: z.literal("assign"), niche: zId.nullable(), ids: z.array(zId).max(5000).optional(), query: z.string().max(4000).optional() })
    .refine((v) => !!v.ids !== (v.query !== undefined), "ids ou query"),
  z.object({ action: z.literal("auto"), apply: z.boolean() }),
]);

const payload = () => {
  const s = nicheStats();
  return { niches: allNiches({ archived: true }), stats: Object.fromEntries(s) };
};

// Page Niches : création, édition, correspondances, fusion, archivage, attribution en lot.
export const GET = route(async () => {
  await requireSession();
  return NextResponse.json(payload());
});
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  try {
    let extra: Record<string, unknown> = {};
    if (b.action === "create") extra = { id: createNiche(b.niche) };
    else if (b.action === "update") updateNiche(b.id, { ...b.niche, archived: b.archived });
    else if (b.action === "maps") setNicheMaps(b.id, b.kind as (typeof MAP_KINDS)[number], b.values);
    else if (b.action === "merge") extra = { moved: mergeNiches(b.from, b.into) };
    else if (b.action === "assign") {
      const ids = b.ids ?? idsForFilter(withQueue(readFilters(Object.fromEntries(new URLSearchParams(b.query))).f), 5000);
      extra = { changed: assignNiche(ids, b.niche) };
    } else if (b.action === "auto") extra = autoAssign(b.apply);
    revalidatePath("/", "layout");
    return NextResponse.json({ ...payload(), ...extra });
  } catch (e) {
    if (e instanceof NicheError) throw new HttpError(400, e.message);
    throw e;
  }
});
