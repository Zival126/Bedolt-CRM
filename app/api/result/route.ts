import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { applyResult } from "@/lib/outcomes";
import { dayCounts } from "@/lib/crm";
import { MOTIFS } from "@/lib/constants";
import { RESULTS } from "@/lib/stage";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date AAAA-MM-JJ attendue");
const Body = z.object({
  id: zId,
  result: z.enum(RESULTS),
  template: z.enum(["first", "j2", "j7"]).optional(),
  canal: z.enum(["whatsapp", "appel"]).optional(),
  motif: z.enum(MOTIFS.map((m) => m.key) as [string, ...string[]]).optional(),
  detail: z.string().max(500).optional(),
  next_step: z.string().max(500).optional(),
  date: z.union([z.literal(""), day]).optional(),
  toCall: z.boolean().optional(),
});

// Résultat en 1 clic (file du jour, mode focus, fiche) : transition + journal + jeton d'annulation.
export const POST = route(async (req) => {
  await requireSession();
  const input = await readJson(req, Body);
  const r = applyResult({ ...input, date: input.date || undefined });
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, undo: r.undo, message: r.message, follow: r.follow ?? null, statut: r.business.statut, counts: dayCounts() });
});
