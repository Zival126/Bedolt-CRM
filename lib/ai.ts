import { getSetting } from "./settings";

export const OFFLINE = "IA hors ligne";
export type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: ToolCall[] };
export type ToolCall = { function: { name: string; arguments: Record<string, unknown> | string } };

export const provider = () => (getSetting("ia_provider") === "n8n" ? "n8n" : "ollama");
const ollamaUrl = () => (getSetting("ollama_url") || "").replace(/\/+$/, "");

export async function listModels(url: string): Promise<string[]> {
  const r = await fetch(url.replace(/\/+$/, "") + "/api/tags", { signal: AbortSignal.timeout(5000), cache: "no-store" });
  if (!r.ok) throw new Error(`Ollama a répondu ${r.status}`);
  const j = (await r.json()) as { models?: { name: string }[] };
  return (j.models ?? []).map((m) => m.name);
}

/** État de connexion (utilisé par l'indicateur et le panneau de chat). */
export async function status(): Promise<{ online: boolean; provider: string; message?: string }> {
  const p = provider();
  try {
    if (p === "n8n") {
      if (!getSetting("n8n_url")) return { online: false, provider: p, message: "URL n8n non configurée" };
      return { online: true, provider: p };
    }
    if (!ollamaUrl()) return { online: false, provider: p, message: "URL Ollama non configurée" };
    await listModels(ollamaUrl());
    return { online: true, provider: p };
  } catch {
    return { online: false, provider: p, message: OFFLINE };
  }
}

/** Flux NDJSON d'Ollama /api/chat (stream: true). */
export async function* ollamaStream(messages: Msg[], tools?: unknown[]): AsyncGenerator<{ message?: Msg; done?: boolean }> {
  const model = getSetting("ollama_model");
  if (!ollamaUrl() || !model) throw new Error("Ollama : URL ou modèle non configuré (Réglages > IA).");
  let res: Response;
  try {
    res = await fetch(ollamaUrl() + "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true, ...(tools?.length ? { tools } : {}) }),
    });
  } catch { throw new Error(OFFLINE); }
  if (!res.ok || !res.body) throw new Error(`Ollama ${res.status} : ${(await res.text()).slice(0, 200)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line);
    }
  }
}

/** Appel n8n : on envoie le message + l'historique, on attend { reply } (ou texte brut) en retour. */
export async function n8nAsk(payload: Record<string, unknown>): Promise<string> {
  const url = getSetting("n8n_url");
  if (!url) throw new Error("URL du webhook n8n non configurée.");
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(120_000) });
  } catch { throw new Error(OFFLINE); }
  const text = await res.text();
  if (!res.ok) throw new Error(`n8n ${res.status} : ${text.slice(0, 200)}`);
  try { const j = JSON.parse(text); return String(j.reply ?? j.output ?? j.text ?? j.message ?? text); } catch { return text; }
}

/** Réponse complète sans streaming (classement). `json` force une sortie JSON côté Ollama. */
export async function complete(system: string, user: string, json = false): Promise<string> {
  if (provider() === "n8n") return n8nAsk({ system, message: user, history: [] });
  let out = "";
  const model = getSetting("ollama_model");
  if (!ollamaUrl() || !model) throw new Error("Ollama : URL ou modèle non configuré (Réglages > IA).");
  let res: Response;
  try {
    res = await fetch(ollamaUrl() + "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(300_000),
      body: JSON.stringify({ model, stream: false, ...(json ? { format: "json" } : {}),
        messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
  } catch { throw new Error(OFFLINE); }
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  out = ((await res.json()) as { message: Msg }).message.content;
  return out;
}
