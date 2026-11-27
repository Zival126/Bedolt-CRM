// Couche fournisseur IA commune (serveur uniquement) : chat, classement IA et file IA passent tous par ici.
//
// Fournisseurs :
//  - « ollama »  : API native d'Ollama (/api/tags, /api/chat en NDJSON) — inchangée ;
//  - « openai »  : serveur compatible OpenAI (LM Studio, llama.cpp llama-server, Ollama en mode /v1, service en ligne) :
//                  GET {base}/models, POST {base}/chat/completions (SSE quand stream: true), tool calling, json_schema ;
//  - « n8n »     : webhook (POST {system, message, history} → {reply}) : ni streaming ni outils.
//
// Règles :
//  - Toutes les URL passent par aiFetch (protection SSRF, pas de redirection, délai maximum).
//  - Délais : test / modèles 5 s ; requête non streamée 120 s ; streaming : inactivité réglable (défaut 120 s).
//  - Les blocs <think>…</think> (et reasoning_content) sont retirés avant affichage et avant toute lecture JSON.
//  - La clé API reste côté serveur (jamais renvoyée au navigateur ni écrite dans le journal).
//  - Chaque appel est journalisé (ai_calls : date, tâche, fiche, durée, tokens, erreur — sans contenu ni secret).
import { z } from "zod";
import { db, now } from "./db";
import { getSetting } from "./settings";
import { aiFetch, UrlRefused } from "./ai-guard";

export const OFFLINE = "IA hors ligne";
export type Provider = "ollama" | "openai" | "n8n";
export type ToolCall = { id: string; name: string; arguments: string };
export type LlmMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string; name?: string };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type Usage = { prompt?: number; completion?: number };
export type ChatOpts = {
  messages: LlmMsg[]; tools?: ToolDef[]; temperature?: number; maxTokens?: number;
  /** Sortie structurée : schéma JSON envoyé au serveur (response_format / format). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** Journal : tâche (chat, analyse, message, classement…) et fiche concernée. */
  task?: string; businessId?: number | null;
};
export type ChatResult = { content: string; raw: string; toolCalls: ToolCall[]; usage: Usage; model: string };
export type StreamEvent = { type: "token"; text: string } | { type: "done"; result: ChatResult };

/** Délais (ms). Modifiables par les tests. */
export const TIMEOUTS = { test: 5_000, complete: 120_000, streamMax: 15 * 60_000 };

/** Erreur HTTP du serveur IA (le serveur répond, mais refuse la requête). */
export class LlmHttpError extends Error {
  constructor(public status: number, message: string, public body = "") { super(message); }
}

// ---------- Configuration ----------
export type LlmConfig = { provider: Provider; url: string; model: string; key: string };
const trimSlash = (s: string) => s.trim().replace(/\/+$/, "");
/** URL de base OpenAI : « http://h:1234 » devient « http://h:1234/v1 » (chemin vide). */
export function openaiBase(raw: string): string {
  const s = trimSlash(raw);
  if (!s) return "";
  try { const u = new URL(s); return u.pathname === "/" || u.pathname === "" ? s + "/v1" : s; } catch { return s; }
}
export function providerSetting(): Provider {
  const p = getSetting("ia_provider");
  return p === "n8n" || p === "openai" ? p : "ollama";
}
export function llmConfig(over: Partial<LlmConfig> = {}): LlmConfig {
  const provider = over.provider ?? providerSetting();
  const base: LlmConfig = provider === "openai" ? { provider, url: openaiBase(getSetting("openai_url")), model: getSetting("openai_model"), key: getSetting("openai_key") }
    : provider === "n8n" ? { provider, url: getSetting("n8n_url").trim(), model: "n8n", key: "" }
    : { provider, url: trimSlash(getSetting("ollama_url")), model: getSetting("ollama_model"), key: "" };
  const c = { ...base, ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined)) } as LlmConfig;
  if (c.provider === "openai") c.url = openaiBase(c.url);
  return c;
}
export const providerLabel = (p: Provider) => (p === "openai" ? "OpenAI compatible" : p === "n8n" ? "n8n" : "Ollama");
/** En-tête Authorization (clé optionnelle ; LM Studio accepte n'importe quelle valeur, défaut « lm-studio »). */
const authHeaders = (c: LlmConfig): Record<string, string> => (c.provider === "openai" ? { Authorization: `Bearer ${c.key || "lm-studio"}` } : {});

// Paramètres par tâche (Réglages › IA)
const Task = (t: number, max: number) => z.object({ temperature: z.number().min(0).max(2).default(t), maxTokens: z.number().int().min(32).max(16_000).default(max) }).prefault({});
export const IaParamsSchema = z.object({
  analyse: Task(0.2, 800),
  message: Task(0.7, 500),
  contextTokens: z.number().int().min(1000).max(128_000).default(6000),   // taille max du contexte envoyé (tokens estimés)
  streamIdleS: z.number().int().min(10).max(900).default(120),           // délai d'inactivité du streaming
  noThink: z.boolean().default(true),                                    // ajoute « /no_think » (Qwen3) : réponses plus rapides
});
export type IaParams = z.infer<typeof IaParamsSchema>;
export function iaParams(): IaParams {
  let raw: unknown = {};
  try { raw = JSON.parse(getSetting("ia_params") || "{}"); } catch { raw = {}; }
  const r = IaParamsSchema.safeParse(raw);
  return r.success ? r.data : IaParamsSchema.parse({});
}
const streamIdleMs = () => Number(process.env.AI_STREAM_IDLE_MS) || iaParams().streamIdleS * 1000;

// ---------- Utilitaires ----------
/** Retire le raisonnement : blocs <think>…</think>, raisonnement sans balise ouvrante (« … </think> réponse »), bloc non fermé. */
export function stripThink(s: string): string {
  let x = s.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "");
  const close = [...x.matchAll(/<\/think\s*>/gi)].at(-1);
  if (close?.index !== undefined) x = x.slice(close.index + close[0].length);
  const open = x.search(/<think\b[^>]*>/i);
  if (open >= 0) x = x.slice(0, open);
  return x.trim();
}

/** Filtre de streaming : supprime le contenu des blocs <think>…</think>, même coupés entre deux morceaux. */
export class ThinkFilter {
  private buf = "";
  private inThink = false;
  push(chunk: string): string {
    this.buf += chunk;
    let out = "";
    for (;;) {
      if (this.inThink) {
        const m = this.buf.match(/<\/think\s*>/i);
        if (!m || m.index === undefined) { this.buf = holdPrefix(this.buf, "</think>"); return out; }
        this.buf = this.buf.slice(m.index + m[0].length);
        this.inThink = false;
        continue;
      }
      const m = this.buf.match(/<think\b[^>]*>/i);
      if (m && m.index !== undefined) { out += this.buf.slice(0, m.index); this.buf = this.buf.slice(m.index + m[0].length); this.inThink = true; continue; }
      const held = holdPrefix(this.buf, "<think>");
      out += this.buf.slice(0, this.buf.length - held.length);
      this.buf = held;
      return out;
    }
  }
  flush(): string { const r = this.inThink ? "" : this.buf; this.buf = ""; this.inThink = false; return r; }
}
/** Fin de `s` qui pourrait être le début de `tag` (à garder pour le morceau suivant). */
function holdPrefix(s: string, tag: string): string {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (tag.startsWith(s.slice(-n).toLowerCase())) return s.slice(-n);
  return "";
}

/** Premier objet JSON d'une réponse (après retrait du raisonnement et d'éventuels blocs ```json). */
export function extractJson(raw: string): unknown {
  const s = stripThink(raw);
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  for (const cand of [fenced, s].filter(Boolean) as string[]) {
    const a = cand.indexOf("{"), b = cand.lastIndexOf("}");
    if (a < 0 || b <= a) continue;
    try { return JSON.parse(cand.slice(a, b + 1)); } catch { /* candidat suivant */ }
  }
  throw new Error("pas d'objet JSON dans la réponse");
}

/** Arguments d'un appel d'outil : chaîne JSON (OpenAI) ou objet (Ollama). Erreur lisible si invalide. */
export function parseToolArgs(a: string): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (!a.trim()) return { ok: true, args: {} };
  try {
    const v = JSON.parse(a);
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "les arguments doivent être un objet JSON" };
    return { ok: true, args: v as Record<string, unknown> };
  } catch (e) { return { ok: false, error: "arguments JSON invalides (" + (e as Error).message.slice(0, 120) + ")" }; }
}

/** Erreur réseau → « IA hors ligne », délai dépassé → message clair, refus SSRF → tel quel. */
function netError(e: unknown, timeoutMs?: number): Error {
  if (e instanceof UrlRefused || e instanceof LlmHttpError) return e;
  const err = e as Error;
  if (err?.name === "TimeoutError" && timeoutMs) return new Error(`IA : pas de réponse en ${Math.round(timeoutMs / 1000)} s (modèle trop lent, ou PC éteint).`, { cause: e });
  return new Error(OFFLINE, { cause: e });
}
const tooLong = (s: string, n = 200) => s.replace(/\s+/g, " ").slice(0, n);

async function httpError(r: Response, who: string): Promise<LlmHttpError> {
  const body = await r.text().catch(() => "");
  let msg = body;
  try { const j = JSON.parse(body); msg = String(j.error?.message ?? j.error ?? j.message ?? body); } catch { /* texte brut */ }
  return new LlmHttpError(r.status, `${who} a répondu ${r.status}${msg ? " : " + tooLong(msg) : ""}`, body.slice(0, 2000));
}

// ---------- Journal des appels ----------
export function logCall(e: { task: string; businessId?: number | null; provider: string; model: string; ms: number; usage?: Usage; error?: string }) {
  try {
    db.prepare(`INSERT INTO ai_calls(at, task, business_id, provider, model, ms, prompt_tokens, completion_tokens, error) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(now(), e.task.slice(0, 40), e.businessId ?? null, e.provider, e.model.slice(0, 120), Math.round(e.ms), e.usage?.prompt ?? null, e.usage?.completion ?? null, (e.error ?? "").slice(0, 300));
    db.prepare("DELETE FROM ai_calls WHERE id <= (SELECT id FROM ai_calls ORDER BY id DESC LIMIT 1 OFFSET 500)").run();
  } catch (err) { console.warn("[bedolt-crm] journal IA impossible :", (err as Error).message); }
}
export type AiCall = { id: number; at: string; task: string; business_id: number | null; nom: string | null; provider: string; model: string; ms: number; prompt_tokens: number | null; completion_tokens: number | null; error: string };
export const aiCalls = (limit = 100) => db.prepare(`SELECT c.*, b.nom FROM ai_calls c LEFT JOIN businesses b ON b.id = c.business_id ORDER BY c.id DESC LIMIT ?`).all(limit) as AiCall[];

// ---------- Modèles / état ----------
export async function listModels(c: LlmConfig = llmConfig()): Promise<string[]> {
  if (c.provider === "n8n") return [];
  if (!c.url) throw new Error("URL non configurée.");
  const isOai = c.provider === "openai";
  let r: Response;
  try { r = await aiFetch(c.url + (isOai ? "/models" : "/api/tags"), { headers: authHeaders(c), timeoutMs: TIMEOUTS.test }); }
  catch (e) { throw netError(e, TIMEOUTS.test); }
  if (!r.ok) throw await httpError(r, isOai ? "Le serveur IA" : "Ollama");
  let j: { models?: { name: string }[]; data?: { id: string }[] };
  try { j = await r.json(); } catch { throw new Error(`Réponse illisible (est-ce bien un serveur ${providerLabel(c.provider)} ?)`); }
  return isOai ? (j.data ?? []).map((m) => String(m.id)).filter(Boolean) : (j.models ?? []).map((m) => m.name);
}

export type AiStatus = { online: boolean; configured: boolean; provider: Provider; model: string; message: string; checkedAt: string };
const g = globalThis as unknown as { __aiStatus?: { at: number; v: AiStatus; key: string }; __aiStatusP?: Promise<AiStatus> };
const STATUS_TTL_MS = 60_000;
const offlineHint = (p: Provider) => p === "openai" ? "Ton PC est éteint ou LM Studio n'est pas lancé (serveur local arrêté)." : p === "ollama" ? "Ton PC est éteint ou Ollama n'est pas lancé." : "Le webhook n8n ne répond pas.";

async function checkStatus(c: LlmConfig): Promise<AiStatus> {
  const base = { provider: c.provider, model: c.model, checkedAt: now() };
  if (!c.url) return { ...base, online: false, configured: false, message: `URL ${providerLabel(c.provider)} non configurée (Réglages › IA).` };
  if (c.provider === "n8n") return { ...base, online: true, configured: true, message: "" };
  try {
    const models = await listModels(c);
    if (!c.model) return { ...base, online: false, configured: false, message: `Serveur joignable (${models.length} modèle(s)) mais aucun modèle choisi (Réglages › IA).` };
    if (models.length && !models.includes(c.model)) return { ...base, online: true, configured: true, message: `Modèle « ${c.model} » absent de la liste du serveur (il sera peut-être chargé à la demande).` };
    return { ...base, online: true, configured: true, message: "" };
  } catch (e) {
    return { ...base, online: false, configured: true, message: e instanceof UrlRefused ? e.message : e instanceof LlmHttpError ? e.message : `${OFFLINE} — ${offlineHint(c.provider)}` };
  }
}

/**
 * État « IA en ligne / hors ligne » (cache 60 s). `fresh` : nouveau test. `stale` : renvoie tout de suite la dernière
 * valeur connue (même expirée) et rafraîchit en arrière-plan — pour la navigation, qui ne doit jamais attendre 5 s.
 */
export async function aiStatus(opts: { fresh?: boolean; stale?: boolean } = {}): Promise<AiStatus> {
  const c = llmConfig();
  const key = [c.provider, c.url, c.model].join("|");
  const hit = g.__aiStatus?.key === key ? g.__aiStatus : undefined;
  const run = () => (g.__aiStatusP ??= checkStatus(c).then((v) => { g.__aiStatus = { at: Date.now(), v, key }; return v; }).finally(() => { g.__aiStatusP = undefined; }));
  if (!opts.fresh && hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.v;
  if (opts.stale && hit) { void run().catch(() => {}); return hit.v; }
  return run();
}
/** Dernier état connu sans réseau (null : jamais testé). */
export const cachedAiStatus = (): AiStatus | null => g.__aiStatus?.v ?? null;
export const resetAiStatus = () => { g.__aiStatus = undefined; };

// ---------- Corps des requêtes ----------
function oaiMessages(msgs: LlmMsg[]) {
  return msgs.map((m) => {
    if (m.role === "assistant" && m.tool_calls?.length)
      return { role: "assistant", content: m.content || null, tool_calls: m.tool_calls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })) };
    if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
    return { role: m.role, content: m.content };
  });
}
function ollamaMessages(msgs: LlmMsg[]) {
  return msgs.map((m) => {
    if (m.role === "assistant" && m.tool_calls?.length)
      return { role: "assistant", content: m.content, tool_calls: m.tool_calls.map((t) => ({ function: { name: t.name, arguments: (parseToolArgs(t.arguments) as { args?: object }).args ?? {} } })) };
    if (m.role === "tool") return { role: "tool", content: m.content, ...(m.name ? { tool_name: m.name } : {}) };
    return { role: m.role, content: m.content };
  });
}
function requestFor(c: LlmConfig, o: ChatOpts, stream: boolean, schemaMode: boolean) {
  if (!c.url || !c.model) throw new Error(`${providerLabel(c.provider)} : URL ou modèle non configuré (Réglages › IA).`);
  if (c.provider === "openai") {
    return { url: c.url + "/chat/completions", body: {
      model: c.model, messages: oaiMessages(o.messages), stream,
      ...(o.temperature !== undefined ? { temperature: o.temperature } : {}), ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
      ...(o.tools?.length ? { tools: o.tools } : {}),
      ...(schemaMode && o.jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: o.jsonSchema.name, strict: true, schema: o.jsonSchema.schema } } } : {}),
    } };
  }
  return { url: c.url + "/api/chat", body: {
    model: c.model, messages: ollamaMessages(o.messages), stream,
    options: { ...(o.temperature !== undefined ? { temperature: o.temperature } : {}), ...(o.maxTokens ? { num_predict: o.maxTokens } : {}) },
    ...(o.tools?.length ? { tools: o.tools } : {}),
    ...(schemaMode && o.jsonSchema ? { format: o.jsonSchema.schema } : {}),
  } };
}

// ---------- n8n ----------
export async function n8nAsk(payload: Record<string, unknown>, url = getSetting("n8n_url")): Promise<string> {
  if (!url) throw new Error("URL du webhook n8n non configurée.");
  let res: Response;
  try { res = await aiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), timeoutMs: TIMEOUTS.complete }); }
  catch (e) { throw netError(e, TIMEOUTS.complete); }
  const text = await res.text();
  if (!res.ok) throw new LlmHttpError(res.status, `n8n ${res.status} : ${tooLong(text)}`, text);
  try { const j = JSON.parse(text); return String(j.reply ?? j.output ?? j.text ?? j.message ?? text); } catch { return text; }
}
function n8nPayload(msgs: LlmMsg[]) {
  const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = msgs.filter((m) => m.role === "user" || m.role === "assistant");
  const last = rest.at(-1);
  return { system, message: last?.content ?? "", history: rest.slice(0, -1).map((m) => ({ role: m.role, content: m.content })) };
}

// ---------- Requête non streamée ----------
async function chatOnce(c: LlmConfig, o: ChatOpts, schemaMode: boolean): Promise<ChatResult> {
  if (c.provider === "n8n") { const raw = await n8nAsk(n8nPayload(o.messages), c.url); return { content: stripThink(raw), raw, toolCalls: [], usage: {}, model: "n8n" }; }
  const { url, body } = requestFor(c, o, false, schemaMode);
  let r: Response;
  try { r = await aiFetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(c) }, body: JSON.stringify(body), timeoutMs: TIMEOUTS.complete }); }
  catch (e) { throw netError(e, TIMEOUTS.complete); }
  if (!r.ok) throw await httpError(r, c.provider === "openai" ? "Le serveur IA" : "Ollama");
  let j: Record<string, unknown>;
  try { j = await r.json(); } catch (e) { throw (e as Error).name === "TimeoutError" ? netError(e, TIMEOUTS.complete) : new Error("Réponse IA illisible."); }
  if (c.provider === "openai") {
    const msg = ((j.choices as { message?: Record<string, unknown> }[] | undefined)?.[0]?.message ?? {}) as { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] };
    const raw = typeof msg.content === "string" ? msg.content : "";
    const toolCalls = (msg.tool_calls ?? []).map((t, i) => ({ id: t.id || `call_${i}`, name: String(t.function?.name ?? ""), arguments: typeof t.function?.arguments === "string" ? t.function.arguments : JSON.stringify(t.function?.arguments ?? {}) }));
    const u = j.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    return { content: stripThink(raw), raw, toolCalls, usage: { prompt: u?.prompt_tokens, completion: u?.completion_tokens }, model: String(j.model || c.model) };
  }
  const m = (j.message ?? {}) as { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] };
  const raw = m.content ?? "";
  return { content: stripThink(raw), raw, toolCalls: (m.tool_calls ?? []).map((t, i) => ({ id: `call_${i}`, name: t.function.name, arguments: typeof t.function.arguments === "string" ? t.function.arguments : JSON.stringify(t.function.arguments ?? {}) })),
    usage: { prompt: j.prompt_eval_count as number | undefined, completion: j.eval_count as number | undefined }, model: String(j.model || c.model) };
}

/** Réponse complète (sans streaming), journalisée. */
export async function chat(o: ChatOpts, c: LlmConfig = llmConfig()): Promise<ChatResult> {
  const t0 = Date.now();
  try {
    const r = await chatOnce(c, o, !!o.jsonSchema);
    logCall({ task: o.task ?? "chat", businessId: o.businessId, provider: c.provider, model: r.model, ms: Date.now() - t0, usage: r.usage });
    return r;
  } catch (e) {
    logCall({ task: o.task ?? "chat", businessId: o.businessId, provider: c.provider, model: c.model, ms: Date.now() - t0, error: (e as Error).message });
    throw e;
  }
}

// ---------- Streaming ----------
/** Lignes d'un corps de réponse, avec délai d'inactivité (annule la requête ET le lecteur). */
async function* readLines(open: (signal: AbortSignal) => Promise<Response>, who: string, idleMs: number): AsyncGenerator<string> {
  const idle = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const onIdle = () => { idle.abort(); reader?.cancel().catch(() => {}); };
  let timer = setTimeout(onIdle, idleMs);
  const touch = () => { clearTimeout(timer); timer = setTimeout(onIdle, idleMs); };
  const idleError = () => new Error(`IA : aucune donnée reçue depuis ${Math.round(idleMs / 1000)} s.`);
  try {
    let res: Response;
    try { res = await open(idle.signal); } catch (e) { throw idle.signal.aborted ? idleError() : netError(e, TIMEOUTS.streamMax); }
    if (!res.ok || !res.body) throw await httpError(res, who);
    touch();
    reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch (e) { throw idle.signal.aborted ? idleError() : netError(e); }
      if (chunk.done) { if (idle.signal.aborted) throw idleError(); break; }
      touch();
      buf += dec.decode(chunk.value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1); yield line; }
    }
    if (buf.trim()) yield buf;
  } finally { clearTimeout(timer); }
}

const warnLine = (who: string, line: string) => console.warn(`[bedolt-crm] ligne ${who} illisible ignorée :`, line.slice(0, 120));

/**
 * Chat en streaming : jetons au fil de l'eau (raisonnement <think> déjà retiré), puis le résultat complet
 * (appels d'outils assemblés, arguments en chaîne JSON). n8n : une seule réponse d'un bloc.
 */
export async function* chatStream(o: ChatOpts, c: LlmConfig = llmConfig()): AsyncGenerator<StreamEvent> {
  const t0 = Date.now();
  const filter = new ThinkFilter();
  let raw = "", model = c.model;
  const usage: Usage = {};
  try {
    if (c.provider === "n8n") {
      const r = await chatOnce(c, o, false);
      if (r.content) yield { type: "token", text: r.content };
      logCall({ task: o.task ?? "chat", businessId: o.businessId, provider: c.provider, model: "n8n", ms: Date.now() - t0 });
      yield { type: "done", result: r };
      return;
    }
    const { url, body } = requestFor(c, o, true, !!o.jsonSchema);
    const open = (signal: AbortSignal) => aiFetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(c) }, body: JSON.stringify(body), timeoutMs: TIMEOUTS.streamMax, signal });
    const calls: { id: string; name: string; arguments: string }[] = [];
    const emit = (text: string) => { raw += text; return filter.push(text); };
    if (c.provider === "openai") {
      for await (const line of readLines(open, "Le serveur IA", streamIdleMs())) {
        const l = line.trim();
        if (!l || l.startsWith(":") || /^(event|id|retry):/.test(l)) continue;
        if (!l.startsWith("data:")) { warnLine("SSE", l); continue; }
        const data = l.slice(5).trim();
        if (data === "[DONE]") break;
        let j: { model?: string; error?: { message?: string } | string; usage?: { prompt_tokens?: number; completion_tokens?: number };
          choices?: { delta?: { content?: string | null; reasoning_content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
        try { j = JSON.parse(data); } catch { warnLine("SSE", data); continue; }
        if (j.error) throw new Error("Serveur IA : " + tooLong(typeof j.error === "string" ? j.error : String(j.error.message ?? "erreur")));
        if (j.model) model = j.model;
        if (j.usage) { usage.prompt = j.usage.prompt_tokens; usage.completion = j.usage.completion_tokens; }
        const d = j.choices?.[0]?.delta;
        if (!d) continue;
        // reasoning_content (raisonnement séparé) : jamais affiché
        if (typeof d.content === "string" && d.content) { const t = emit(d.content); if (t) yield { type: "token", text: t }; }
        for (const tc of d.tool_calls ?? []) {
          const k = tc.index ?? calls.length;
          const cur = (calls[k] ??= { id: "", name: "", arguments: "" });
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (typeof tc.function?.arguments === "string") cur.arguments += tc.function.arguments;
        }
      }
    } else {
      for await (const line of readLines(open, "Ollama", streamIdleMs())) {
        if (!line.trim()) continue;
        let j: { model?: string; error?: string; done?: boolean; prompt_eval_count?: number; eval_count?: number; message?: { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] } };
        try { j = JSON.parse(line); } catch { warnLine("Ollama", line); continue; }
        if (j.error) throw new Error("Ollama : " + tooLong(String(j.error)));
        if (j.model) model = j.model;
        if (j.message?.content) { const t = emit(j.message.content); if (t) yield { type: "token", text: t }; }
        for (const tc of j.message?.tool_calls ?? []) calls.push({ id: `call_${calls.length}`, name: tc.function.name, arguments: typeof tc.function.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function.arguments ?? {}) });
        if (j.done) { usage.prompt = j.prompt_eval_count; usage.completion = j.eval_count; }
      }
    }
    const tail = filter.flush();
    if (tail) yield { type: "token", text: tail };
    const toolCalls = calls.filter(Boolean).map((t, i) => ({ id: t.id || `call_${i}`, name: t.name, arguments: t.arguments }));
    logCall({ task: o.task ?? "chat", businessId: o.businessId, provider: c.provider, model, ms: Date.now() - t0, usage });
    yield { type: "done", result: { content: stripThink(raw), raw, toolCalls, usage, model } };
  } catch (e) {
    logCall({ task: o.task ?? "chat", businessId: o.businessId, provider: c.provider, model, ms: Date.now() - t0, error: (e as Error).message });
    throw e;
  }
}

// ---------- Sorties structurées ----------
const g2 = globalThis as unknown as { __schemaRefused?: Set<string> };
const schemaRefused = (g2.__schemaRefused ??= new Set<string>());

/**
 * Réponse JSON validée par zod. 1) avec le schéma côté serveur (response_format json_schema / format Ollama) ;
 * si le serveur refuse : 2) consigne « réponds uniquement en JSON » + extraction. Réponse invalide : 1 nouvel essai
 * en expliquant l'erreur. Le raisonnement <think> est retiré avant la lecture.
 */
export async function structured<T>(o: ChatOpts & { jsonSchema: { name: string; schema: Record<string, unknown> }; schema: z.ZodType<T> }, c: LlmConfig = llmConfig()): Promise<{ data: T; model: string }> {
  const key = `${c.provider}|${c.url}`;
  const instruct = (msgs: LlmMsg[]): LlmMsg[] => {
    const rule = `Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni bloc de code, conforme à ce schéma JSON :\n${JSON.stringify(o.jsonSchema.schema)}`;
    const i = msgs.findIndex((m) => m.role === "system");
    return i >= 0 ? msgs.map((m, k) => (k === i ? { ...m, content: m.content + "\n\n" + rule } as LlmMsg : m)) : [{ role: "system", content: rule }, ...msgs];
  };
  let schemaMode = c.provider !== "n8n" && !schemaRefused.has(key);
  let msgs = instruct(o.messages);
  const run = async (m: LlmMsg[]) => {
    try { return await chat({ ...o, messages: m, jsonSchema: schemaMode ? o.jsonSchema : undefined }, c); }
    catch (e) {
      // Le serveur refuse response_format / format : repli sans schéma (mémorisé pour ce serveur).
      if (schemaMode && e instanceof LlmHttpError && e.status >= 400 && e.status < 600) {
        schemaRefused.add(key); schemaMode = false;
        return chat({ ...o, messages: m, jsonSchema: undefined }, c);
      }
      throw e;
    }
  };
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await run(msgs);
    last = r.raw;
    let why: string;
    try {
      const parsed = o.schema.safeParse(extractJson(r.raw));
      if (parsed.success) return { data: parsed.data, model: r.model };
      why = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "racine"} : ${i.message}`).join(" ; ");
    } catch (e) { why = (e as Error).message; }
    msgs = [...msgs, { role: "assistant", content: r.content.slice(0, 4000) }, { role: "user", content: `Ta réponse n'est pas valide (${why}). Renvoie UNIQUEMENT l'objet JSON demandé, conforme au schéma.` }];
  }
  throw new Error("Réponse de l'IA illisible (JSON invalide après 2 essais) : " + tooLong(stripThink(last), 120));
}

/** Estimation grossière du nombre de tokens (≈ 3,5 caractères par token en français / espagnol). */
export const estimateTokens = (s: string) => Math.ceil(s.length / 3.5);
