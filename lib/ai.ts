import { getSetting } from "./settings";
import { aiFetch, UrlRefused } from "./ai-guard";

export const OFFLINE = "IA hors ligne";
export type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: ToolCall[] };
export type ToolCall = { function: { name: string; arguments: Record<string, unknown> | string } };

// Délais : test / liste des modèles 5 s ; streaming : 30 s sans recevoir de données (AI_STREAM_IDLE_MS pour changer).
const TEST_TIMEOUT_MS = 5_000;
const STREAM_IDLE_MS = Number(process.env.AI_STREAM_IDLE_MS) || 30_000;
const STREAM_MAX_MS = 15 * 60_000;
const COMPLETE_TIMEOUT_MS = 300_000;
const N8N_TIMEOUT_MS = 120_000;

export const provider = () => (getSetting("ia_provider") === "n8n" ? "n8n" : "ollama");
const ollamaUrl = () => (getSetting("ollama_url") || "").replace(/\/+$/, "");

/** Erreur réseau → « IA hors ligne », sauf refus SSRF (message explicite). */
const netError = (e: unknown) => (e instanceof UrlRefused ? e : new Error(OFFLINE, { cause: e }));

export async function listModels(url: string): Promise<string[]> {
  const r = await aiFetch(url.replace(/\/+$/, "") + "/api/tags", { timeoutMs: TEST_TIMEOUT_MS });
  if (!r.ok) throw new Error(`Ollama a répondu ${r.status}`);
  let j: { models?: { name: string }[] };
  try { j = await r.json(); } catch { throw new Error("Réponse Ollama illisible (est-ce bien un serveur Ollama ?)"); }
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
  } catch (e) {
    return { online: false, provider: p, message: e instanceof UrlRefused ? e.message : OFFLINE };
  }
}

/** Flux NDJSON d'Ollama /api/chat (stream: true). Coupé après 30 s sans données. */
export async function* ollamaStream(messages: Msg[], tools?: unknown[]): AsyncGenerator<{ message?: Msg; done?: boolean }> {
  const model = getSetting("ollama_model");
  if (!ollamaUrl() || !model) throw new Error("Ollama : URL ou modèle non configuré (Réglages > IA).");
  // Inactivité : on annule la requête ET le lecteur du flux (l'annulation du signal seule ne coupe pas
  // toujours un corps de réponse déjà en cours de lecture).
  const idle = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const onIdle = () => { idle.abort(); reader?.cancel().catch(() => {}); };
  let timer = setTimeout(onIdle, STREAM_IDLE_MS);
  const touch = () => { clearTimeout(timer); timer = setTimeout(onIdle, STREAM_IDLE_MS); };
  const idleError = () => new Error(`IA : aucune donnée reçue depuis ${Math.round(STREAM_IDLE_MS / 1000)} s.`);
  try {
    let res: Response;
    try {
      res = await aiFetch(ollamaUrl() + "/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, timeoutMs: STREAM_MAX_MS, signal: idle.signal,
        body: JSON.stringify({ model, messages, stream: true, ...(tools?.length ? { tools } : {}) }),
      });
    } catch (e) { throw idle.signal.aborted ? idleError() : netError(e); }
    if (!res.ok || !res.body) throw new Error(`Ollama ${res.status} : ${(await res.text().catch(() => "")).slice(0, 200)}`);
    touch();
    reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const parseLine = (line: string) => {
      try { return JSON.parse(line) as { message?: Msg; done?: boolean; error?: string }; }
      catch { console.warn("[bedolt-crm] ligne Ollama illisible ignorée :", line.slice(0, 120)); return null; }
    };
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch (e) { throw idle.signal.aborted ? idleError() : netError(e); }
      if (chunk.done) { if (idle.signal.aborted) throw idleError(); break; }
      touch();
      buf += dec.decode(chunk.value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const o = line ? parseLine(line) : null;
        if (o?.error) throw new Error("Ollama : " + String(o.error).slice(0, 200));
        if (o) yield o;
      }
    }
    const rest = buf.trim() ? parseLine(buf.trim()) : null;
    if (rest) yield rest;
  } finally {
    clearTimeout(timer);
  }
}

/** Appel n8n : on envoie le message + l'historique, on attend { reply } (ou texte brut) en retour. */
export async function n8nAsk(payload: Record<string, unknown>): Promise<string> {
  const url = getSetting("n8n_url");
  if (!url) throw new Error("URL du webhook n8n non configurée.");
  let res: Response;
  try {
    res = await aiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), timeoutMs: N8N_TIMEOUT_MS });
  } catch (e) { throw netError(e); }
  const text = await res.text();
  if (!res.ok) throw new Error(`n8n ${res.status} : ${text.slice(0, 200)}`);
  try { const j = JSON.parse(text); return String(j.reply ?? j.output ?? j.text ?? j.message ?? text); } catch { return text; }
}

/** Réponse complète sans streaming (classement). `json` force une sortie JSON côté Ollama. */
export async function complete(system: string, user: string, json = false): Promise<string> {
  if (provider() === "n8n") return n8nAsk({ system, message: user, history: [] });
  const model = getSetting("ollama_model");
  if (!ollamaUrl() || !model) throw new Error("Ollama : URL ou modèle non configuré (Réglages > IA).");
  let res: Response;
  try {
    res = await aiFetch(ollamaUrl() + "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, timeoutMs: COMPLETE_TIMEOUT_MS,
      body: JSON.stringify({ model, stream: false, ...(json ? { format: "json" } : {}),
        messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
  } catch (e) { throw netError(e); }
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  try { return ((await res.json()) as { message: Msg }).message.content; }
  catch { throw new Error("Réponse Ollama illisible."); }
}
