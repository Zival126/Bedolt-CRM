// Couche fournisseur IA commune (serveur uniquement) : chat, classement IA et file IA passent tous par ici.
//
// Fournisseurs :
//  - « ollama »  : API native d'Ollama (/api/tags, /api/chat en NDJSON) ;
//  - « openai »  : serveur compatible OpenAI (LM Studio, llama.cpp llama-server, Ollama en mode /v1, service en ligne) :
//                  GET {base}/models, POST {base}/chat/completions en SSE, tool calling, response_format ;
//                  + pour LM Studio ≥ 0.4 : POST /api/v1/chat avec reasoning: "off" (seul paramètre documenté par
//                  LM Studio pour couper le raisonnement ; /v1/chat/completions n'en a aucun) — repli automatique ;
//  - « n8n »     : webhook (POST {system, message, history} → {reply}) : ni streaming ni outils.
//
// Règles :
//  - Toutes les URL passent par aiFetch (protection SSRF, pas de redirection, délai maximum).
//  - Toujours en streaming (même pour l'analyse et le message) : une génération lente qui AVANCE n'est pas coupée.
//    Délais : test / modèles 5 s ; délai max par génération (Réglages › IA : 600 s file / nuit, 300 s « Générer ») ;
//    inactivité (aucun token reçu) réglable, défaut 120 s.
//  - Le raisonnement (<think>…</think>, reasoning_content, reasoning) est retiré avant affichage et lecture JSON.
//  - La clé API reste côté serveur (jamais renvoyée au navigateur ni écrite dans le journal).
//  - Journal ai_calls : date, tâche, fiche, durée, tokens, vitesse, finish_reason ; en cas d'échec, les 500 premiers
//    caractères de la réponse brute (jamais la requête ni la clé).
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
/** Format de sortie demandé au serveur : schéma JSON, objet JSON libre, texte, ou API native LM Studio (raisonnement coupé). */
export type OutMode = "json_schema" | "json_object" | "text" | "native";
export type Progress = { tokens: number; reasoning: number };
export type ChatOpts = {
  messages: LlmMsg[]; tools?: ToolDef[]; temperature?: number; maxTokens?: number;
  /** Sortie structurée : schéma JSON envoyé au serveur (response_format / format). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  mode?: OutMode;
  /** Journal : tâche (chat, analyse, message, classement…) et fiche concernée. */
  task?: string; businessId?: number | null;
  /** Délai max de la génération (ms) et délai d'inactivité (ms) ; défauts : Réglages › IA. */
  deadlineMs?: number; idleMs?: number;
  /** Appelé à chaque token reçu (affichage « X tokens reçus »). */
  onProgress?: (p: Progress) => void;
  /** Couper le raisonnement quand le serveur le permet (API native LM Studio). */
  reasoningOff?: boolean;
};
export type ChatResult = {
  content: string; raw: string; toolCalls: ToolCall[]; usage: Usage; model: string;
  finishReason: string | null; tokensPerS: number | null; outTokens: number; logId: number | null;
};
export type StreamEvent = { type: "token"; text: string } | { type: "done"; result: ChatResult };

/** Délais fixes (ms), modifiables par les tests. */
export const TIMEOUTS = { test: 5_000 };

/** Erreur HTTP du serveur IA (le serveur répond, mais refuse la requête). */
export class LlmHttpError extends Error {
  constructor(public status: number, message: string, public body = "") { super(message); }
}
/** Le serveur refuse ce format de sortie / ce point d'entrée (on essaie le suivant). */
const isRefusal = (e: unknown) => e instanceof LlmHttpError && [400, 404, 405, 415, 422, 501].includes(e.status);

// ---------- Configuration ----------
export type LlmConfig = { provider: Provider; url: string; model: string; key: string };
const trimSlash = (s: string) => s.trim().replace(/\/+$/, "");
/** URL de base OpenAI : « http://h:1234 » devient « http://h:1234/v1 » (chemin vide). */
export function openaiBase(raw: string): string {
  const s = trimSlash(raw);
  if (!s) return "";
  try { const u = new URL(s); return u.pathname === "/" || u.pathname === "" ? s + "/v1" : s; } catch { return s; }
}
/** Racine du serveur (sans /v1) pour l'API native LM Studio. */
const serverRoot = (base: string) => base.replace(/\/v1$/, "");
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

// Paramètres (Réglages › IA)
const Task = (t: number, max: number) => z.object({ temperature: z.number().min(0).max(2).default(t), maxTokens: z.number().int().min(32).max(16_000).default(max) }).prefault({});
export const IaParamsSchema = z.object({
  analyse: Task(0.2, 600),
  message: Task(0.7, 500),
  contextTokens: z.number().int().min(1000).max(128_000).default(6000),   // taille max du contexte envoyé (tokens estimés)
  streamIdleS: z.number().int().min(10).max(1800).default(120),          // inactivité max : aucun token reçu
  genTimeoutS: z.number().int().min(30).max(7200).default(600),          // délai max par génération : file IA et nuit
  manualTimeoutS: z.number().int().min(30).max(7200).default(300),       // délai max par génération : « Générer » sur la fiche
  noThink: z.boolean().default(true),                                    // couper le raisonnement (/no_think + API native LM Studio)
  lmsNative: z.enum(["auto", "off"]).default("auto"),                    // API native LM Studio (reasoning: "off") pour l'analyse et le message
});
export type IaParams = z.infer<typeof IaParamsSchema>;
export function iaParams(): IaParams {
  let raw: unknown = {};
  try { raw = JSON.parse(getSetting("ia_params") || "{}"); } catch { raw = {}; }
  const r = IaParamsSchema.safeParse(raw);
  return r.success ? r.data : IaParamsSchema.parse({});
}
const defaultIdleMs = () => Number(process.env.AI_STREAM_IDLE_MS) || iaParams().streamIdleS * 1000;
const defaultDeadlineMs = () => iaParams().genTimeoutS * 1000;

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

/** Premier objet JSON {…} ÉQUILIBRÉ de `s` (accolades dans les chaînes ignorées) qui se lit sans erreur. */
export function firstJsonObject(s: string): unknown {
  for (let start = s.indexOf("{"); start >= 0; start = s.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  throw new Error("pas d'objet JSON complet dans la réponse");
}

/**
 * Objet JSON d'une réponse de modèle : raisonnement retiré (<think>…</think>, <think> jamais fermé, « … </think> »),
 * blocs ```json … ``` essayés d'abord, puis premier objet équilibré (texte avant / après ignoré).
 */
export function extractJson(raw: string): unknown {
  const s = stripThink(raw);
  const fences = [...s.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)(?:```|$)/g)].map((m) => m[1]);
  for (const cand of [...fences, s]) { try { return firstJsonObject(cand); } catch { /* candidat suivant */ } }
  if (/\{/.test(s)) throw new Error("JSON incomplet (réponse coupée ?)");
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

const tooLong = (s: string, n = 200) => s.replace(/\s+/g, " ").slice(0, n);
const secs = (ms: number) => Math.round(ms / 1000);
/** Erreur réseau → « IA hors ligne », refus SSRF / HTTP → tels quels. */
function netError(e: unknown): Error {
  if (e instanceof UrlRefused || e instanceof LlmHttpError) return e;
  const err = e as Error;
  if (err?.name === "TimeoutError") return new Error(`IA : pas de réponse en ${secs(TIMEOUTS.test)} s.`, { cause: e });
  return new Error(OFFLINE, { cause: e });
}

async function httpError(r: Response, who: string): Promise<LlmHttpError> {
  const body = await r.text().catch(() => "");
  let msg = body;
  try { const j = JSON.parse(body); msg = String(j.error?.message ?? j.error ?? j.message ?? body); } catch { /* texte brut */ }
  return new LlmHttpError(r.status, `${who} a répondu ${r.status}${msg ? " : " + tooLong(msg) : ""}`, body.slice(0, 2000));
}

// ---------- Journal des appels ----------
export type CallLog = { task: string; businessId?: number | null; provider: string; model: string; ms: number; usage?: Usage; error?: string;
  finishReason?: string | null; tokensPerS?: number | null; outTokens?: number; raw?: string; mode?: string };
/** Enregistre un appel ; renvoie son identifiant (pour y ajouter l'erreur de lecture JSON ensuite). */
export function logCall(e: CallLog): number | null {
  try {
    const id = Number(db.prepare(`INSERT INTO ai_calls(at, task, business_id, provider, model, ms, prompt_tokens, completion_tokens, error, finish_reason, tokens_per_s, out_tokens, raw, mode)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(now(), e.task.slice(0, 40), e.businessId ?? null, e.provider, e.model.slice(0, 120), Math.round(e.ms), e.usage?.prompt ?? null, e.usage?.completion ?? null,
      (e.error ?? "").slice(0, 300), (e.finishReason ?? "").slice(0, 20), e.tokensPerS ?? null, e.outTokens ?? null, e.error ? (e.raw ?? "").slice(0, 500) : "", (e.mode ?? "").slice(0, 20)).lastInsertRowid);
    db.prepare("DELETE FROM ai_calls WHERE id <= (SELECT id FROM ai_calls ORDER BY id DESC LIMIT 1 OFFSET 500)").run();
    return id;
  } catch (err) { console.warn("[bedolt-crm] journal IA impossible :", (err as Error).message); return null; }
}
/** Réponse reçue mais inutilisable (JSON invalide, coupée) : erreur + 500 premiers caractères de la réponse brute. */
export function markCallFailed(id: number | null, error: string, raw: string) {
  if (id == null) return;
  try { db.prepare("UPDATE ai_calls SET error = ?, raw = ? WHERE id = ?").run(error.slice(0, 300), raw.slice(0, 500), id); } catch { /* journal facultatif */ }
}
export type AiCall = { id: number; at: string; task: string; business_id: number | null; nom: string | null; provider: string; model: string; ms: number;
  prompt_tokens: number | null; completion_tokens: number | null; error: string; finish_reason: string; tokens_per_s: number | null; out_tokens: number | null; raw: string; mode: string };
export const aiCalls = (limit = 100) => db.prepare(`SELECT c.*, b.nom FROM ai_calls c LEFT JOIN businesses b ON b.id = c.business_id ORDER BY c.id DESC LIMIT ?`).all(limit) as AiCall[];

// ---------- Modèles / état ----------
export async function listModels(c: LlmConfig = llmConfig()): Promise<string[]> {
  if (c.provider === "n8n") return [];
  if (!c.url) throw new Error("URL non configurée.");
  const isOai = c.provider === "openai";
  let r: Response;
  try { r = await aiFetch(c.url + (isOai ? "/models" : "/api/tags"), { headers: authHeaders(c), timeoutMs: TIMEOUTS.test }); }
  catch (e) { throw netError(e); }
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
/** API native LM Studio : un prompt système + une entrée texte (la conversation de correction est mise à plat). */
function nativeInput(msgs: LlmMsg[]) {
  const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = msgs.filter((m) => m.role !== "system");
  const input = rest.length === 1 ? rest[0].content : rest.map((m) => (m.role === "assistant" ? "Ta réponse précédente :\n" : "") + m.content).join("\n\n");
  return { system, input };
}
type Req = { url: string; body: Record<string, unknown>; kind: "oai" | "ollama" | "native" };
function requestFor(c: LlmConfig, o: ChatOpts): Req {
  if (!c.url || !c.model) throw new Error(`${providerLabel(c.provider)} : URL ou modèle non configuré (Réglages › IA).`);
  const mode = o.mode ?? (o.jsonSchema ? "json_schema" : "text");
  if (c.provider === "openai" && mode === "native") {
    const { system, input } = nativeInput(o.messages);
    return { kind: "native", url: serverRoot(c.url) + "/api/v1/chat", body: {
      model: c.model, system_prompt: system, input, stream: true, store: false, reasoning: "off",
      ...(o.temperature !== undefined ? { temperature: Math.min(1, o.temperature) } : {}), ...(o.maxTokens ? { max_output_tokens: o.maxTokens } : {}),
    } };
  }
  if (c.provider === "openai") {
    return { kind: "oai", url: c.url + "/chat/completions", body: {
      model: c.model, messages: oaiMessages(o.messages), stream: true,
      ...(o.temperature !== undefined ? { temperature: o.temperature } : {}), ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
      ...(o.tools?.length ? { tools: o.tools } : {}),
      ...(mode === "json_schema" && o.jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: o.jsonSchema.name, strict: true, schema: o.jsonSchema.schema } } } : {}),
      ...(mode === "json_object" ? { response_format: { type: "json_object" } } : {}),
    } };
  }
  return { kind: "ollama", url: c.url + "/api/chat", body: {
    model: c.model, messages: ollamaMessages(o.messages), stream: true,
    options: { ...(o.temperature !== undefined ? { temperature: o.temperature } : {}), ...(o.maxTokens ? { num_predict: o.maxTokens } : {}) },
    ...(o.tools?.length ? { tools: o.tools } : {}),
    ...(mode === "json_schema" && o.jsonSchema ? { format: o.jsonSchema.schema } : mode === "json_object" ? { format: "json" } : {}),
    ...(o.reasoningOff ? { think: false } : {}),
  } };
}

// ---------- n8n ----------
export async function n8nAsk(payload: Record<string, unknown>, url = getSetting("n8n_url"), timeoutMs = defaultDeadlineMs()): Promise<string> {
  if (!url) throw new Error("URL du webhook n8n non configurée.");
  let res: Response;
  try { res = await aiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), timeoutMs }); }
  catch (e) { throw (e as Error).name === "TimeoutError" ? new Error(`IA : délai max de génération dépassé (${secs(timeoutMs)} s).`) : netError(e); }
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

// ---------- Streaming ----------
/**
 * Lignes d'un corps de réponse. Deux délais : `idleMs` sans aucune donnée (le modèle ne produit plus rien) et
 * `deadlineMs` au total (génération trop longue). Une génération lente mais qui avance n'est jamais coupée avant.
 */
async function* readLines(open: (signal: AbortSignal) => Promise<Response>, who: string, idleMs: number, deadlineMs: number): AsyncGenerator<string> {
  const ctl = new AbortController();
  let why: "idle" | "deadline" | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const stop = (w: "idle" | "deadline") => { why ??= w; ctl.abort(); reader?.cancel().catch(() => {}); };
  let idle = setTimeout(() => stop("idle"), idleMs);
  const deadline = setTimeout(() => stop("deadline"), deadlineMs);
  const touch = () => { clearTimeout(idle); idle = setTimeout(() => stop("idle"), idleMs); };
  const timeErr = () => why === "deadline"
    ? new Error(`IA : délai max de génération dépassé (${secs(deadlineMs)} s). Augmente « Délai max par génération » (Réglages › IA) si ton PC est lent.`)
    : new Error(`IA : aucune donnée reçue depuis ${secs(idleMs)} s.`);
  try {
    let res: Response;
    try { res = await open(ctl.signal); } catch (e) { throw why ? timeErr() : netError(e); }
    if (!res.ok || !res.body) throw await httpError(res, who);
    touch();
    reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch (e) { throw why ? timeErr() : netError(e); }
      if (chunk.done) { if (why) throw timeErr(); break; }
      touch();
      buf += dec.decode(chunk.value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1); yield line; }
    }
    if (buf.trim()) yield buf;
  } finally { clearTimeout(idle); clearTimeout(deadline); }
}

const warnLine = (who: string, line: string) => console.warn(`[bedolt-crm] ligne ${who} illisible ignorée :`, line.slice(0, 120));
/** Erreur de génération avec ce qui a été reçu (pour le journal). */
export class LlmStreamError extends Error { constructor(message: string, public raw: string, public cause?: unknown) { super(message); } }

/**
 * Chat en streaming : jetons au fil de l'eau (raisonnement retiré), puis le résultat complet (appels d'outils assemblés,
 * arguments en chaîne JSON, finish_reason, vitesse). Chaque appel est journalisé. n8n : une seule réponse d'un bloc.
 */
export async function* chatStream(o: ChatOpts, c: LlmConfig = llmConfig()): AsyncGenerator<StreamEvent> {
  const t0 = Date.now();
  const filter = new ThinkFilter();
  const deadlineMs = o.deadlineMs ?? defaultDeadlineMs(), idleMs = o.idleMs ?? defaultIdleMs();
  let raw = "", model = c.model, finishReason: string | null = null, firstAt = 0, lastAt = 0, tokens = 0, reasoning = 0, lmsSpeed: number | null = null;
  const usage: Usage = {};
  const mode = c.provider === "openai" && o.mode === "native" ? "native" : o.mode ?? (o.jsonSchema ? "json_schema" : "text");
  const base = { task: o.task ?? "chat", businessId: o.businessId, provider: c.provider, mode };
  const tick = (isReasoning: boolean) => {
    const t = Date.now(); if (!firstAt) firstAt = t; lastAt = t;
    if (isReasoning) reasoning++; else tokens++;
    o.onProgress?.({ tokens: tokens + reasoning, reasoning });
  };
  try {
    if (c.provider === "n8n") {
      raw = await n8nAsk(n8nPayload(o.messages), c.url, deadlineMs);
      const content = stripThink(raw);
      if (content) yield { type: "token", text: content };
      const logId = logCall({ ...base, model: "n8n", ms: Date.now() - t0 });
      yield { type: "done", result: { content, raw, toolCalls: [], usage: {}, model: "n8n", finishReason: "stop", tokensPerS: null, outTokens: 0, logId } };
      return;
    }
    const req = requestFor(c, { ...o, mode });
    const open = (signal: AbortSignal) => aiFetch(req.url, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(c) }, body: JSON.stringify(req.body), timeoutMs: deadlineMs + 5000, signal });
    const calls: { id: string; name: string; arguments: string }[] = [];
    const emit = (text: string) => { raw += text; tick(false); return filter.push(text); };
    const who = req.kind === "ollama" ? "Ollama" : "Le serveur IA";
    for await (const line of readLines(open, who, idleMs, deadlineMs)) {
      if (req.kind === "ollama") {
        if (!line.trim()) continue;
        let j: { model?: string; error?: string; done?: boolean; done_reason?: string; prompt_eval_count?: number; eval_count?: number; message?: { content?: string; thinking?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] } };
        try { j = JSON.parse(line); } catch { warnLine("Ollama", line); continue; }
        if (j.error) throw new Error("Ollama : " + tooLong(String(j.error)));
        if (j.model) model = j.model;
        if (j.message?.thinking) tick(true);
        if (j.message?.content) { const t = emit(j.message.content); if (t) yield { type: "token", text: t }; }
        for (const tc of j.message?.tool_calls ?? []) calls.push({ id: `call_${calls.length}`, name: tc.function.name, arguments: typeof tc.function.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function.arguments ?? {}) });
        if (j.done) { usage.prompt = j.prompt_eval_count; usage.completion = j.eval_count; finishReason = j.done_reason ?? "stop"; }
        continue;
      }
      const l = line.trim();
      if (!l || l.startsWith(":") || /^(event|id|retry):/.test(l)) continue;
      if (!l.startsWith("data:")) { warnLine("SSE", l); continue; }
      const data = l.slice(5).trim();
      if (data === "[DONE]") break;
      let j: Record<string, unknown>;
      try { j = JSON.parse(data); } catch { warnLine("SSE", data); continue; }
      if (req.kind === "native") {
        // Événements LM Studio : message.delta, reasoning.delta, error, chat.end (stats)
        const type = String(j.type ?? "");
        if (type === "message.delta" && typeof j.content === "string") { const t = emit(j.content); if (t) yield { type: "token", text: t }; }
        else if (type === "reasoning.delta") tick(true);
        else if (type === "error") throw new Error("LM Studio : " + tooLong(String((j.error as { message?: string } | undefined)?.message ?? "erreur")));
        else if (type === "chat.end") {
          const r = (j.result ?? {}) as { model_instance_id?: string; stats?: { input_tokens?: number; total_output_tokens?: number; tokens_per_second?: number } };
          if (r.model_instance_id) model = r.model_instance_id;
          usage.prompt = r.stats?.input_tokens; usage.completion = r.stats?.total_output_tokens;
          lmsSpeed = r.stats?.tokens_per_second ?? null;
          finishReason = o.maxTokens && (r.stats?.total_output_tokens ?? 0) >= o.maxTokens ? "length" : "stop";
        }
        continue;
      }
      const err = j.error as { message?: string } | string | undefined;
      if (err) throw new Error("Serveur IA : " + tooLong(typeof err === "string" ? err : String(err.message ?? "erreur")));
      if (typeof j.model === "string") model = j.model;
      const u = j.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      if (u) { usage.prompt = u.prompt_tokens; usage.completion = u.completion_tokens; }
      const ch = (j.choices as { finish_reason?: string | null; delta?: { content?: string | null; reasoning_content?: string; reasoning?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] | undefined)?.[0];
      if (!ch) continue;
      if (ch.finish_reason) finishReason = ch.finish_reason;
      const d = ch.delta;
      if (!d) continue;
      // reasoning_content / reasoning (raisonnement séparé) : compté, jamais affiché
      if (d.reasoning_content || d.reasoning) tick(true);
      if (typeof d.content === "string" && d.content) { const t = emit(d.content); if (t) yield { type: "token", text: t }; }
      for (const tc of d.tool_calls ?? []) {
        const k = tc.index ?? calls.length;
        const cur = (calls[k] ??= { id: "", name: "", arguments: "" });
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (typeof tc.function?.arguments === "string") cur.arguments += tc.function.arguments;
      }
    }
    const tail = filter.flush();
    if (tail) yield { type: "token", text: tail };
    const toolCalls = calls.filter(Boolean).map((t, i) => ({ id: t.id || `call_${i}`, name: t.name, arguments: t.arguments }));
    const outTokens = usage.completion ?? tokens + reasoning;
    const genS = firstAt && lastAt > firstAt ? (lastAt - firstAt) / 1000 : 0;
    const tokensPerS = lmsSpeed ?? (genS > 0 ? Math.round((outTokens / genS) * 10) / 10 : null);
    const logId = logCall({ ...base, model, ms: Date.now() - t0, usage, finishReason, tokensPerS, outTokens });
    yield { type: "done", result: { content: stripThink(raw), raw, toolCalls, usage, model, finishReason, tokensPerS, outTokens, logId } };
  } catch (e) {
    const genS = firstAt && lastAt > firstAt ? (lastAt - firstAt) / 1000 : 0;
    logCall({ ...base, model, ms: Date.now() - t0, error: (e as Error).message, raw: raw || (reasoning ? `(seulement du raisonnement : ${reasoning} tokens)` : ""), finishReason,
      outTokens: tokens + reasoning, tokensPerS: genS > 0 ? Math.round(((tokens + reasoning) / genS) * 10) / 10 : null });
    throw e;
  }
}

/** Réponse complète (streamée en interne pour ne pas couper une génération lente qui avance), journalisée. */
export async function chat(o: ChatOpts, c: LlmConfig = llmConfig()): Promise<ChatResult> {
  for await (const ev of chatStream(o, c)) if (ev.type === "done") return ev.result;
  throw new Error("Réponse IA vide.");
}

// ---------- Sorties structurées ----------
const g2 = globalThis as unknown as { __modeRefused?: Set<string> };
const modeRefused = (g2.__modeRefused ??= new Set<string>());
export const resetModeRefusals = () => modeRefused.clear();

/**
 * Réponse JSON validée par zod, en essayant dans l'ordre (en sautant ce que ce serveur a déjà refusé) :
 *   [API native LM Studio, raisonnement coupé] → json_schema → json_object → texte (« réponds uniquement en JSON »)
 *   → texte avec l'erreur expliquée.
 * Réponse coupée (finish_reason = "length") : relancée UNE fois avec max_tokens doublé. Chaque échec de lecture est
 * journalisé avec l'extrait brut. Durée totale bornée (≈ 2 × le délai max par génération).
 */
export async function structured<T>(o: ChatOpts & { jsonSchema: { name: string; schema: Record<string, unknown> }; schema: z.ZodType<T> }, c: LlmConfig = llmConfig()): Promise<{ data: T; model: string; mode: OutMode }> {
  const key = `${c.provider}|${c.url}`;
  const instruct = (msgs: LlmMsg[]): LlmMsg[] => {
    const rule = `Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni bloc de code, conforme à ce schéma JSON :\n${JSON.stringify(o.jsonSchema.schema)}`;
    const i = msgs.findIndex((m) => m.role === "system");
    return i >= 0 ? msgs.map((m, k) => (k === i ? { ...m, content: m.content + "\n\n" + rule } as LlmMsg : m)) : [{ role: "system", content: rule }, ...msgs];
  };
  const native = c.provider === "openai" && o.reasoningOff && iaParams().lmsNative !== "off";
  const plan: OutMode[] = c.provider === "n8n" ? ["text", "text"] : [...(native ? ["native" as const] : []), "json_schema", "json_object", "text", "text"];
  const modes = plan.filter((m) => m === "text" || !modeRefused.has(`${key}|${m}`));
  const budget = (o.deadlineMs ?? defaultDeadlineMs()) * 2, t0 = Date.now();
  let msgs = instruct(o.messages), maxTokens = o.maxTokens, doubled = false, last = "", lastWhy = "";
  for (let i = 0; i < modes.length;) {
    if (i > 0 && Date.now() - t0 > budget) break;
    const mode = modes[i];
    let r: ChatResult;
    try { r = await chat({ ...o, messages: msgs, maxTokens, mode }, c); }
    catch (e) {
      if (mode !== "text" && isRefusal(e)) { modeRefused.add(`${key}|${mode}`); i++; continue; }   // format refusé : suivant
      throw e;
    }
    last = r.raw;
    try {
      const parsed = o.schema.safeParse(extractJson(r.raw));
      if (parsed.success) return { data: parsed.data, model: r.model, mode };
      lastWhy = parsed.error.issues.slice(0, 3).map((x) => `${x.path.join(".") || "racine"} : ${x.message}`).join(" ; ");
    } catch (e) { lastWhy = (e as Error).message; }
    const cut = r.finishReason === "length";
    markCallFailed(r.logId, `JSON invalide${cut ? " (réponse coupée : limite de tokens)" : ""} — ${lastWhy}`, r.raw);
    if (cut && !doubled && maxTokens) { doubled = true; maxTokens *= 2; continue; }      // même format, 2 × max_tokens
    msgs = [...instruct(o.messages), { role: "assistant", content: stripThink(r.raw).slice(0, 4000) }, { role: "user", content: `Ta réponse n'est pas valide (${lastWhy}). Renvoie UNIQUEMENT l'objet JSON demandé, complet et conforme au schéma, sans rien autour.` }];
    i++;
  }
  throw new Error(`Réponse de l'IA illisible (JSON invalide : ${lastWhy || "aucune réponse"}) : ` + tooLong(stripThink(last), 120));
}

/** Estimation grossière du nombre de tokens (≈ 3,5 caractères par token en français / espagnol). */
export const estimateTokens = (s: string) => Math.ceil(s.length / 3.5);
