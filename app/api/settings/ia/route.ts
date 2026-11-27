import { NextResponse } from "next/server";
import { z } from "zod";
import { getSetting, setSetting, maskToken } from "@/lib/settings";
import { assertSafeAiUrl, UrlRefused } from "@/lib/ai-guard";
import { iaParams, IaParamsSchema, resetAiStatus, openaiBase } from "@/lib/llm";
import { nightSettings, NightSchema, kickAi, cancunClock } from "@/lib/ai-prepare";
import { HttpError, requireSession } from "@/lib/session";
import { readJson, route } from "@/lib/api";

const url = z.string().trim().max(500).optional();
const Body = z.object({
  ia_provider: z.enum(["ollama", "openai", "n8n"]).optional(),
  ollama_url: url, ollama_model: z.string().trim().max(200).optional(),
  openai_url: url, openai_model: z.string().trim().max(200).optional(),
  // Clé API : absente = inchangée ; "" avec openai_key_clear = effacée. Jamais renvoyée au navigateur.
  openai_key: z.string().trim().max(500).regex(/^[\x21-\x7e]*$/, "caractères invalides dans la clé").optional(), openai_key_clear: z.boolean().optional(),
  n8n_url: url, ia_mode: z.enum(["tools", "context"]).optional(),
  ia_params: IaParamsSchema.optional(),
  ia_style: z.string().max(4000).optional(),
  ia_night: NightSchema.optional(),
});

const view = () => {
  const key = getSetting("openai_key");
  return {
    provider: getSetting("ia_provider") || "ollama", ollama_url: getSetting("ollama_url"), ollama_model: getSetting("ollama_model"),
    openai_url: getSetting("openai_url"), openai_model: getSetting("openai_model"), openai_key_set: !!key, openai_key_masked: maskToken(key),
    n8n_url: getSetting("n8n_url"), ia_mode: getSetting("ia_mode") || "tools", ia_params: iaParams(), ia_style: getSetting("ia_style"), ia_night: nightSettings(),
  };
};

export const GET = route(async () => { await requireSession(); return NextResponse.json(view(), { headers: { "Cache-Control": "no-store" } }); });
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  // Protection SSRF : une URL interdite n'est pas enregistrée.
  for (const [k, label] of [["ollama_url", "Ollama"], ["openai_url", "Serveur OpenAI compatible"], ["n8n_url", "Webhook n8n"]] as const) {
    const v = b[k];
    if (!v) continue;
    try { await assertSafeAiUrl(k === "openai_url" ? openaiBase(v) : v); } catch (e) {
      if (e instanceof UrlRefused) throw new HttpError(400, `${label} : ${e.message}`);
      throw e;
    }
  }
  for (const k of ["ia_provider", "ollama_url", "ollama_model", "openai_url", "openai_model", "n8n_url", "ia_mode", "ia_style"] as const) {
    if (typeof b[k] === "string") setSetting(k, b[k]);
  }
  if (b.openai_key_clear) setSetting("openai_key", "");
  else if (b.openai_key) setSetting("openai_key", b.openai_key);
  if (b.ia_params) setSetting("ia_params", JSON.stringify(b.ia_params));
  if (b.ia_night) {
    const before = nightSettings();
    setSetting("ia_night", JSON.stringify(b.ia_night));
    // Activée / nouvelle heure : si l'heure est déjà passée aujourd'hui (Cancún), première préparation la nuit prochaine.
    if (before.time !== b.ia_night.time || (!before.enabled && b.ia_night.enabled)) { const c = cancunClock(); setSetting("ia_night_last", c.hhmm >= b.ia_night.time ? c.day : ""); }
  }
  resetAiStatus();
  kickAi();
  return NextResponse.json({ ok: true, settings: view() });
});
