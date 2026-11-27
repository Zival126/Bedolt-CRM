// Faux serveur IA local pour les tests : compatible OpenAI (LM Studio : /v1/models, /v1/chat/completions en JSON ou SSE)
// ou Ollama (/api/tags, /api/chat en NDJSON). Chaque test fixe `handle` ; toutes les requêtes sont enregistrées.
import http from "node:http";
import type { AddressInfo } from "node:net";

export type Req = { method: string; path: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> & { messages?: { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }[] } };
export type Handler = (req: Req, res: http.ServerResponse) => void | Promise<void>;

export async function fakeLlm() {
  const calls: Req[] = [];
  const state: { handle: Handler } = { handle: (_q, res) => { res.statusCode = 404; res.end(); } };
  const sockets = new Set<import("node:net").Socket>();
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    let body: Req["body"] = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const r: Req = { method: req.method ?? "GET", path: req.url ?? "/", headers: req.headers, body };
    calls.push(r);
    try { await state.handle(r, res); } catch (e) { res.statusCode = 500; res.end(String(e)); }
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  return {
    port, calls, state,
    base: `http://127.0.0.1:${port}/v1`,
    set handle(h: Handler) { state.handle = h; },
    close: () => new Promise<void>((ok) => { for (const s of sockets) s.destroy(); server.close(() => ok()); }),
  };
}

/** Port fermé (« PC éteint ») : on ouvre un serveur puis on le ferme. */
export async function closedPort(): Promise<number> {
  const s = http.createServer();
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const p = (s.address() as AddressInfo).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return p;
}

export const json = (res: http.ServerResponse, o: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
/** Réponse non streamée au format OpenAI. */
export const completion = (res: http.ServerResponse, content: string, extra: Record<string, unknown> = {}) =>
  json(res, { id: "chatcmpl-1", object: "chat.completion", model: "qwen/qwen3.5-4b", choices: [{ index: 0, message: { role: "assistant", content, ...extra }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 30 } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Flux SSE : chaque élément est un objet (sérialisé en « data: … ») ou une ligne brute. Termine par [DONE] sauf `noDone`. */
export async function sse(res: http.ServerResponse, items: (object | string)[], opts: { delayMs?: number; noDone?: boolean } = {}) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  for (const it of items) {
    res.write(typeof it === "string" ? it + "\n" : `data: ${JSON.stringify(it)}\n\n`);
    if (opts.delayMs) await sleep(opts.delayMs);
  }
  if (!opts.noDone) res.write("data: [DONE]\n\n");
  res.end();
}
export const delta = (d: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: "c1", object: "chat.completion.chunk", model: "qwen/qwen3.5-4b", choices: [{ index: 0, delta: d }], ...extra });
