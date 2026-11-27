import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiStatus } from "@/lib/llm";
import { generateNow } from "@/lib/ai-prepare";
import { aiOutput } from "@/lib/ai-context";
import { getBusiness } from "@/lib/crm";
import { readJson, route, zId } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

export const maxDuration = 300;
const Body = z.object({ id: zId });

// « Générer » / « Régénérer » sur la fiche : analyse puis message, tout de suite. Le résultat est une PROPOSITION
// (ai_outputs) : rien n'est écrit dans la fiche sans « Utiliser ce message ».
export const POST = route(async (req) => {
  await requireSession();
  const { id } = await readJson(req, Body);
  if (!getBusiness(id)) throw new HttpError(404, "Commerce introuvable.");
  const st = await aiStatus({ fresh: true });
  if (!st.online) throw new HttpError(503, st.message || "IA hors ligne.");
  try { await generateNow(id); }
  catch (e) { revalidatePath("/", "layout"); throw new HttpError(502, (e as Error).message); }
  revalidatePath("/", "layout");
  const o = aiOutput(id)!;
  return NextResponse.json({ ok: true, output: { ...o, improvements: JSON.parse(o.improvements || "[]") } });
});
