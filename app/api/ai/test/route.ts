import { NextResponse } from "next/server";
import { z } from "zod";
import { listModels, llmConfig, LlmHttpError, OFFLINE, TIMEOUTS } from "@/lib/llm";
import { UrlRefused } from "@/lib/ai-guard";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({
  provider: z.enum(["ollama", "openai", "n8n"]).optional(),
  url: z.string().trim().max(500).optional(),
  key: z.string().trim().max(500).optional(),   // vide : clé enregistrée (jamais renvoyée au navigateur)
});

// « Tester la connexion » : URL fournie (pas encore enregistrée), liste des modèles (délai : 5 s).
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  const c = llmConfig({ provider: b.provider, url: b.url || undefined, key: b.key || undefined });
  if (!c.url) return NextResponse.json({ ok: false, message: "URL manquante." }, { status: 400 });
  if (c.provider === "n8n") return NextResponse.json({ ok: true, models: [], message: "Webhook n8n : pas de test de modèles (il sera appelé au premier message)." });
  try {
    const models = await listModels(c);
    return NextResponse.json({ ok: true, models, message: `Connecté — ${models.length} modèle(s).` });
  } catch (e) {
    if (e instanceof UrlRefused) return NextResponse.json({ ok: false, message: e.message }, { status: 400 });
    if (e instanceof LlmHttpError) return NextResponse.json({ ok: false, message: e.status === 401 || e.status === 403 ? "Clé API refusée (" + e.status + ")." : e.message });
    const err = e as Error;
    const why = /pas de réponse/.test(err.message) ? `pas de réponse en ${TIMEOUTS.test / 1000} s` : ((err.cause as Error | undefined)?.message ?? err.message);
    return NextResponse.json({ ok: false, message: `${OFFLINE} : ${why}. Vérifie que ton PC est allumé, que ${c.provider === "openai" ? "LM Studio (serveur local, « Serve on Local Network »)" : "Ollama"} est lancé et que Tailscale est connecté.` });
  }
});
