import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/settings";

export async function GET() {
  return NextResponse.json({
    provider: getSetting("ia_provider") || "ollama", ollama_url: getSetting("ollama_url"), ollama_model: getSetting("ollama_model"),
    n8n_url: getSetting("n8n_url"), ia_mode: getSetting("ia_mode") || "tools",
  });
}
export async function POST(req: Request) {
  const b = await req.json();
  for (const k of ["ia_provider", "ollama_url", "ollama_model", "n8n_url", "ia_mode"] as const) {
    if (typeof b[k] === "string") setSetting(k, b[k].trim());
  }
  return NextResponse.json({ ok: true });
}
