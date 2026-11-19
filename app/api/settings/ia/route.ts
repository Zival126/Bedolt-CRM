import { NextResponse } from "next/server";
import { z } from "zod";
import { getSetting, setSetting } from "@/lib/settings";
import { assertSafeAiUrl, UrlRefused } from "@/lib/ai-guard";
import { HttpError, requireSession } from "@/lib/session";
import { readJson, route } from "@/lib/api";

const url = z.string().trim().max(500).optional();
const Body = z.object({
  ia_provider: z.enum(["ollama", "n8n"]).optional(), ollama_url: url, ollama_model: z.string().trim().max(200).optional(),
  n8n_url: url, ia_mode: z.enum(["tools", "context"]).optional(),
});

export const GET = route(async () => {
  await requireSession();
  return NextResponse.json({
    provider: getSetting("ia_provider") || "ollama", ollama_url: getSetting("ollama_url"), ollama_model: getSetting("ollama_model"),
    n8n_url: getSetting("n8n_url"), ia_mode: getSetting("ia_mode") || "tools",
  });
});
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  // Protection SSRF : une URL interdite n'est pas enregistrée.
  for (const k of ["ollama_url", "n8n_url"] as const) {
    if (!b[k]) continue;
    try { await assertSafeAiUrl(b[k]); } catch (e) {
      if (e instanceof UrlRefused) throw new HttpError(400, (k === "n8n_url" ? "Webhook n8n : " : "Ollama : ") + e.message);
      throw e;
    }
  }
  for (const k of ["ia_provider", "ollama_url", "ollama_model", "n8n_url", "ia_mode"] as const) {
    if (typeof b[k] === "string") setSetting(k, b[k]);
  }
  return NextResponse.json({ ok: true });
});
