import { NextResponse } from "next/server";
import { listModels } from "@/lib/ai";
import { getSetting } from "@/lib/settings";

// Teste l'URL fournie (pas encore enregistrée) et renvoie la liste des modèles via /api/tags.
export async function POST(req: Request) {
  const { url } = (await req.json()) as { url?: string };
  const u = (url || getSetting("ollama_url")).trim();
  if (!u) return NextResponse.json({ ok: false, message: "URL manquante." });
  try {
    const models = await listModels(u);
    return NextResponse.json({ ok: true, models, message: `Connecté — ${models.length} modèle(s).` });
  } catch (e) {
    return NextResponse.json({ ok: false, message: "IA hors ligne : " + (((e as Error).cause as Error | undefined)?.message ?? (e as Error).message) });
  }
}
