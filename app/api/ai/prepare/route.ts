import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiStatus } from "@/lib/llm";
import { requestGenerate, ficheAiState } from "@/lib/ai-prepare";
import { aiOutput } from "@/lib/ai-context";
import { getBusiness } from "@/lib/crm";
import { parse, readJson, route, zId } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const Body = z.object({ id: zId });

const view = (id: number) => {
  const o = aiOutput(id);
  return { state: ficheAiState(id), output: o ? { ...o, improvements: JSON.parse(o.improvements || "[]") } : null };
};

// « Générer » / « Régénérer » sur la fiche : la fiche passe en TÊTE de la file IA et le worker la traite en arrière-plan
// (analyse puis message). Réponse immédiate : la page suit la progression avec GET ?id=. Le résultat reste une
// PROPOSITION (ai_outputs) : rien n'est écrit dans la fiche sans « Utiliser ce message ».
export const POST = route(async (req) => {
  await requireSession();
  const { id } = await readJson(req, Body);
  if (!getBusiness(id)) throw new HttpError(404, "Commerce introuvable.");
  const st = await aiStatus();
  if (!st.online) throw new HttpError(503, st.message || "IA hors ligne.");
  const r = requestGenerate(id);
  revalidatePath("/", "layout");
  return NextResponse.json({ ...r, ...view(id) }, { status: 202 });
});

// Progression : en file (position), en cours (analyse / message, tokens reçus, durée), terminé (proposition).
export const GET = route(async (req) => {
  await requireSession();
  const id = parse(zId, new URL(req.url).searchParams.get("id"));
  return NextResponse.json(view(id), { headers: { "Cache-Control": "no-store" } });
});
