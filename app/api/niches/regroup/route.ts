import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildPlan, applyRegroup, undoRegroup, lastRegroup } from "@/lib/niche-regroup";
import { NicheError } from "@/lib/niches";
import { isIcon } from "@/lib/niche-style";
import { backupNow } from "@/lib/backup-now";
import { readJson, route } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

const Main = z.object({ key: z.string().regex(/^[a-z0-9-]{1,40}$/), label: z.string().trim().min(1).max(60), icon: z.string().refine(isIcon, "icône inconnue") });
const Mains = z.array(Main).min(1).max(40);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan"), mains: Mains }),
  z.object({ action: z.literal("apply"), mains: Mains, assign: z.record(z.string().regex(/^\d+$/), z.string().max(40)) }),
  z.object({ action: z.literal("undo") }),
]);

// Page Niches > Regrouper : proposition, application (sauvegarde de la base juste avant), annulation.
export const GET = route(async () => {
  await requireSession();
  return NextResponse.json({ ...buildPlan(), last: lastRegroup() });
});
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  try {
    if (b.action === "plan") return NextResponse.json({ ...buildPlan(b.mains), last: lastRegroup() });
    if (b.action === "apply") {
      let backup = "";
      try { backup = await backupNow("preregroup"); }
      catch (e) { console.error("[bedolt-crm] sauvegarde avant regroupement", e); throw new HttpError(500, "Sauvegarde de la base impossible : regroupement non appliqué (rien n'a changé)."); }
      const r = applyRegroup(b.mains, Object.fromEntries(Object.entries(b.assign).map(([k, v]) => [Number(k), v])), backup);
      revalidatePath("/", "layout");
      return NextResponse.json({ result: r, ...buildPlan(b.mains), last: lastRegroup() });
    }
    const r = undoRegroup();
    revalidatePath("/", "layout");
    return NextResponse.json({ undone: r, ...buildPlan(), last: lastRegroup() });
  } catch (e) {
    if (e instanceof NicheError) throw new HttpError(400, e.message);
    throw e;
  }
});
