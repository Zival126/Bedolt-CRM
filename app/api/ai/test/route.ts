import { NextResponse } from "next/server";
import { z } from "zod";
import { listModels } from "@/lib/ai";
import { UrlRefused } from "@/lib/ai-guard";
import { readJson, route } from "@/lib/api";
import { getSetting } from "@/lib/settings";
import { requireSession } from "@/lib/session";

const Body = z.object({ url: z.string().trim().max(500).optional() });

// Teste l'URL fournie (pas encore enregistrée) et renvoie la liste des modèles via /api/tags (délai : 5 s).
export const POST = route(async (req) => {
  await requireSession();
  const { url } = await readJson(req, Body);
  const u = (url || getSetting("ollama_url")).trim();
  if (!u) return NextResponse.json({ ok: false, message: "URL manquante." }, { status: 400 });
  try {
    const models = await listModels(u);
    return NextResponse.json({ ok: true, models, message: `Connecté — ${models.length} modèle(s).` });
  } catch (e) {
    if (e instanceof UrlRefused) return NextResponse.json({ ok: false, message: e.message }, { status: 400 });
    const err = e as Error;
    const why = err.name === "TimeoutError" ? "pas de réponse en 5 s" : ((err.cause as Error | undefined)?.message ?? err.message);
    return NextResponse.json({ ok: false, message: "IA hors ligne : " + why });
  }
});
