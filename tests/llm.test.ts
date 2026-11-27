// Couche fournisseur IA (lib/llm.ts) contre un faux serveur compatible OpenAI (LM Studio) et un faux Ollama.
process.env.AI_ALLOWED_HOSTS = "127.0.0.1";   // le faux serveur écoute en local (refusé par défaut : protection SSRF)
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { db } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { insertBusiness } from "@/lib/crm";
import { listModels, aiStatus, resetAiStatus, chatStream, chat, structured, stripThink, ThinkFilter, extractJson, parseToolArgs, openaiBase, TIMEOUTS, llmConfig, OFFLINE, aiCalls } from "@/lib/llm";
import { runChat, MAX_TOOL_ROUNDS, type ChatEvent } from "@/lib/chat-run";
import { fakeLlm, closedPort, json, completion, sse, delta } from "./fake-llm";

let srv: Awaited<ReturnType<typeof fakeLlm>>;
before(async () => { srv = await fakeLlm(); });
after(async () => { await srv.close(); });
const useOpenai = (url = srv.base, key = "") => { setSetting("ia_provider", "openai"); setSetting("openai_url", url); setSetting("openai_model", "qwen/qwen3.5-4b"); setSetting("openai_key", key); setSetting("ia_mode", "tools"); resetAiStatus(); };
beforeEach(() => { srv.calls.length = 0; useOpenai(); db.exec("DELETE FROM ai_calls; DELETE FROM businesses;"); });
const MODELS = { object: "list", data: [{ id: "qwen/qwen3.5-4b", object: "model" }, { id: "text-embedding-nomic", object: "model" }] };

test("retrait du raisonnement <think> : blocs, sans balise ouvrante, non fermé, coupé entre deux morceaux", () => {
  assert.equal(stripThink("<think>je réfléchis</think>\nHola"), "Hola");
  assert.equal(stripThink("raisonnement sans balise…</think> Respuesta"), "Respuesta");
  assert.equal(stripThink("Texte <think>jamais fermé"), "Texte");
  assert.equal(stripThink("A<think>x</think>B<THINK>y</THINK>C"), "ABC");
  const f = new ThinkFilter();
  const out = ["Ho", "la <thi", "nk>secret", " encore</thi", "nk> mundo", " <", "b>"].map((c) => f.push(c)).join("") + f.flush();
  assert.equal(out, "Hola  mundo <b>");
  assert.deepEqual(extractJson('<think>{"faux":1}</think>Voici : ```json\n{"a": 2}\n```'), { a: 2 });
  assert.deepEqual(parseToolArgs('{"id": 3}'), { ok: true, args: { id: 3 } });
  assert.equal(parseToolArgs('{"id": 3,,}').ok, false);
  assert.equal(parseToolArgs("[1]").ok, false);
  assert.equal(openaiBase("http://100.74.33.54:1234/"), "http://100.74.33.54:1234/v1");
  assert.equal(openaiBase("http://h:1234/v1/"), "http://h:1234/v1");
});

test("OpenAI compatible : modèles (GET /models → data[].id), clé Bearer (défaut « lm-studio »), état en ligne mis en cache 60 s", async () => {
  srv.handle = (q, res) => (q.path === "/v1/models" ? json(res, MODELS) : json(res, {}, 404));
  assert.deepEqual(await listModels(), ["qwen/qwen3.5-4b", "text-embedding-nomic"]);
  assert.equal(srv.calls[0].headers.authorization, "Bearer lm-studio");
  useOpenai(srv.base, "sk-secret-1234");
  await listModels();
  assert.equal(srv.calls[1].headers.authorization, "Bearer sk-secret-1234");
  // URL sans /v1 : complétée
  useOpenai(`http://127.0.0.1:${srv.port}`);
  assert.equal(llmConfig().url, srv.base);
  srv.calls.length = 0;
  const s1 = await aiStatus();
  const s2 = await aiStatus();
  assert.deepEqual([s1.online, s2.online, srv.calls.length], [true, true, 1]);   // 2e appel : cache
  await aiStatus({ fresh: true });
  assert.equal(srv.calls.length, 2);
  // Hors ligne : port fermé (PC éteint) → message clair, jamais d'exception
  useOpenai(`http://127.0.0.1:${await closedPort()}/v1`);
  const off = await aiStatus();
  assert.equal(off.online, false);
  assert.match(off.message, /IA hors ligne.*LM Studio/);
  await assert.rejects(chat({ messages: [{ role: "user", content: "hola" }] }), (e: Error) => e.message === OFFLINE);
  // Pas de modèle choisi : non configurée
  useOpenai(); setSetting("openai_model", "");
  const nomodel = await aiStatus();
  assert.deepEqual([nomodel.online, nomodel.configured], [false, false]);
});

test("chat streamé (SSE) : jetons au fil de l'eau, <think> et reasoning_content retirés, lignes invalides ignorées, [DONE]", async () => {
  srv.handle = (q, res) => sse(res, [
    ": ping", delta({ role: "assistant", reasoning_content: "je pense…" }), delta({ content: "<thi" }), delta({ content: "nk>long raisonnement</th" }),
    "data: {pas du json", delta({ content: "ink>¡Hola" }), "event: message", delta({ content: " Bedolt!" }), delta({}, { usage: { prompt_tokens: 50, completion_tokens: 7 } }),
  ]);
  const tokens: string[] = [];
  let done;
  for await (const ev of chatStream({ messages: [{ role: "user", content: "hola" }], temperature: 0.3, maxTokens: 50, task: "chat" })) {
    if (ev.type === "token") tokens.push(ev.text); else done = ev.result;
  }
  assert.equal(tokens.join(""), "¡Hola Bedolt!");
  assert.ok(tokens.length >= 2, "plusieurs jetons");
  assert.equal(done!.content, "¡Hola Bedolt!");
  assert.deepEqual(done!.usage, { prompt: 50, completion: 7 });
  const b = srv.calls[0].body;
  assert.deepEqual([srv.calls[0].path, b.stream, b.temperature, b.max_tokens, b.model], ["/v1/chat/completions", true, 0.3, 50, "qwen/qwen3.5-4b"]);
  const log = aiCalls(5)[0];
  assert.deepEqual([log.task, log.prompt_tokens, log.completion_tokens, log.error], ["chat", 50, 7, ""]);
});

test("tool calling : arguments en chaîne JSON (morceaux), message assistant renvoyé tel quel, tool_call_id, réponse finale", async () => {
  insertBusiness({ nom: "Salón Luna", telephone: "9981112233", ville: "Cancún" });
  srv.handle = (q, res) => {
    const msgs = q.body.messages!;
    if (!msgs.some((m) => m.role === "tool")) return sse(res, [
      delta({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "search_businesses", arguments: "" } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{"ville":' } }] }), delta({ tool_calls: [{ index: 0, function: { arguments: '"Cancún"}' } }] }),
    ]);
    return sse(res, [delta({ content: "Il y a 1 commerce à Cancún." })]);
  };
  const ev: ChatEvent[] = [];
  const r = await runChat({ system: "Assistant", history: [{ role: "user", content: "combien à Cancún ?" }], send: (e) => ev.push(e) });
  assert.equal(r.text, "Il y a 1 commerce à Cancún.");
  assert.ok(ev.some((e) => e.t === "tool" && e.name === "search_businesses"));
  assert.equal(srv.calls.length, 2);
  assert.ok(Array.isArray(srv.calls[0].body.tools) && (srv.calls[0].body.tools as { type: string }[])[0].type === "function");
  const m2 = srv.calls[1].body.messages!;
  const asst = m2.find((m) => m.role === "assistant")! as { tool_calls: { id: string; type: string; function: { name: string; arguments: string } }[] };
  assert.deepEqual(asst.tool_calls, [{ id: "call_abc", type: "function", function: { name: "search_businesses", arguments: '{"ville":"Cancún"}' } }]);
  const tool = m2.find((m) => m.role === "tool")!;
  assert.equal(tool.tool_call_id, "call_abc");
  assert.match(String(tool.content), /Salón Luna/);
});

test("tool calling : 5 tours maximum puis réponse sans outils ; arguments invalides → message propre ; repli « contexte » si les outils sont refusés", async () => {
  srv.handle = (q, res) => {
    if (!q.body.tools) return sse(res, [delta({ content: "Réponse finale." })]);
    return sse(res, [delta({ tool_calls: [{ index: 0, id: "call_" + srv.calls.length, function: { name: "pipeline_stats", arguments: "{}" } }] })]);
  };
  const r = await runChat({ system: "S", history: [{ role: "user", content: "stats" }], send: () => {} });
  assert.equal(r.text, "Réponse finale.");
  assert.equal(srv.calls.filter((c) => c.body.tools).length, MAX_TOOL_ROUNDS);
  assert.equal(srv.calls.length, MAX_TOOL_ROUNDS + 1);

  // Arguments invalides : l'outil n'est pas exécuté, le modèle reçoit une erreur lisible et peut corriger
  srv.calls.length = 0;
  srv.handle = (q, res) => {
    const last = q.body.messages!.at(-1)!;
    if (last.role === "tool") return sse(res, [delta({ content: "Corrigé." })]);
    return sse(res, [delta({ tool_calls: [{ index: 0, id: "call_bad", function: { name: "get_business", arguments: '{"id": 1,,}' } }] })]);
  };
  const r2 = await runChat({ system: "S", history: [{ role: "user", content: "fiche 1" }], send: () => {} });
  assert.equal(r2.text, "Corrigé.");
  assert.match(String(srv.calls[1].body.messages!.at(-1)!.content), /arguments JSON invalides/);

  // Deux tours d'appels invalides de suite → repli automatique sur le mode « contexte injecté »
  srv.calls.length = 0;
  const ev: ChatEvent[] = [];
  srv.handle = (q, res) => q.body.tools ? sse(res, [delta({ tool_calls: [{ index: 0, id: "x", function: { name: "get_business", arguments: "pas du json" } }] })]) : sse(res, [delta({ content: "Mode contexte." })]);
  const r3 = await runChat({ system: "S", history: [{ role: "user", content: "?" }], send: (e) => ev.push(e) });
  assert.equal(r3.text, "Mode contexte.");
  assert.equal(srv.calls.length, 3);
  assert.match(String(srv.calls[2].body.messages![0].content), /Données du CRM/);
  assert.ok(ev.some((e) => e.t === "notice"));

  // Le serveur refuse les outils (400) → même requête en mode contexte
  srv.calls.length = 0;
  srv.handle = (q, res) => q.body.tools ? json(res, { error: { message: "tools are not supported by this model" } }, 400) : sse(res, [delta({ content: "Sans outils." })]);
  const r4 = await runChat({ system: "S", history: [{ role: "user", content: "?" }], send: () => {} });
  assert.equal(r4.text, "Sans outils.");
  assert.deepEqual([srv.calls.length, !!srv.calls[1].body.tools], [2, false]);
});

const Schema = z.object({ resume: z.string(), priorite: z.number() });
const JS = { name: "test_schema", schema: { type: "object", properties: { resume: { type: "string" }, priorite: { type: "integer" } }, required: ["resume", "priorite"], additionalProperties: false } };

test("sorties structurées : json_schema accepté ; refusé → repli « réponds en JSON » + extraction + 1 nouvel essai ; <think> retiré avant parsing", async () => {
  srv.handle = (q, res) => {
    const rf = q.body.response_format as { type: string; json_schema: { name: string; strict: boolean } } | undefined;
    assert.deepEqual([rf?.type, rf?.json_schema.name, rf?.json_schema.strict], ["json_schema", "test_schema", true]);
    completion(res, '<think>{"resume":"piège"}</think>{"resume":"Bon commerce","priorite":72}');
  };
  const a = await structured({ messages: [{ role: "system", content: "Analyse" }, { role: "user", content: "x" }], schema: Schema, jsonSchema: JS, task: "analyse" });
  assert.deepEqual(a.data, { resume: "Bon commerce", priorite: 72 });
  assert.equal(srv.calls.length, 1);

  // Serveur qui refuse response_format : repli, puis réponse invalide → nouvel essai avec l'erreur expliquée
  srv.calls.length = 0;
  let n = 0;
  srv.handle = (q, res) => {
    if (q.body.response_format) return json(res, { error: { message: "'response_format' of type 'json_schema' is not supported" } }, 400);
    n++;
    assert.match(String(q.body.messages![0].content), /Réponds UNIQUEMENT avec un objet JSON/);
    if (n === 1) return completion(res, "Voici l'analyse : {pas du json");
    assert.match(String(q.body.messages!.at(-1)!.content), /n'est pas valide/);
    completion(res, '```json\n{"resume":"Deuxième essai","priorite":40}\n```');
  };
  const b = await structured({ messages: [{ role: "system", content: "Analyse" }, { role: "user", content: "x" }], schema: Schema, jsonSchema: JS });
  assert.deepEqual(b.data, { resume: "Deuxième essai", priorite: 40 });
  assert.equal(srv.calls.length, 3);
  // Le refus est mémorisé pour ce serveur : plus de tentative avec le schéma
  srv.calls.length = 0;
  srv.handle = (q, res) => (q.body.response_format ? json(res, {}, 400) : completion(res, '{"resume":"r","priorite":1}'));
  await structured({ messages: [{ role: "user", content: "x" }], schema: Schema, jsonSchema: JS });
  assert.equal(srv.calls.length, 1);
  assert.equal(srv.calls[0].body.response_format, undefined);
  // Toujours invalide après 2 essais → erreur claire
  srv.handle = (_q, res) => completion(res, "désolé, je ne peux pas");
  await assert.rejects(structured({ messages: [{ role: "user", content: "x" }], schema: Schema, jsonSchema: JS }), /illisible/);
});

test("délais : requête non streamée coupée ; streaming coupé après inactivité ; la clé n'est jamais journalisée", async () => {
  useOpenai(srv.base, "sk-secret-9999");
  const old = TIMEOUTS.complete;
  TIMEOUTS.complete = 150;
  srv.handle = (_q, res) => { setTimeout(() => completion(res, "trop tard"), 600); };
  await assert.rejects(chat({ messages: [{ role: "user", content: "x" }], task: "analyse" }), /pas de réponse en 0 s|pas de réponse/);
  TIMEOUTS.complete = old;
  process.env.AI_STREAM_IDLE_MS = "200";
  srv.handle = (_q, res) => { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write(`data: ${JSON.stringify(delta({ content: "Ho" }))}\n\n`); /* puis silence */ };
  const got: string[] = [];
  await assert.rejects((async () => { for await (const e of chatStream({ messages: [{ role: "user", content: "x" }] })) if (e.type === "token") got.push(e.text); })(), /aucune donnée reçue depuis 0 s|aucune donnée/);
  assert.deepEqual(got, ["Ho"]);
  delete process.env.AI_STREAM_IDLE_MS;
  const rows = JSON.stringify(db.prepare("SELECT * FROM ai_calls").all());
  assert.ok(rows.includes("pas de réponse") && rows.includes("aucune donnée"));
  assert.ok(!rows.includes("sk-secret"), "aucun secret dans le journal");
});

test("Ollama (API native) toujours fonctionnel : /api/tags, /api/chat NDJSON, outils avec arguments objet", async () => {
  setSetting("ia_provider", "ollama"); setSetting("ollama_url", `http://127.0.0.1:${srv.port}`); setSetting("ollama_model", "qwen2.5"); resetAiStatus();
  const nd = (res: import("node:http").ServerResponse, lines: object[]) => { res.writeHead(200, { "Content-Type": "application/x-ndjson" }); for (const l of lines) res.write(JSON.stringify(l) + "\n"); res.end(); };
  srv.handle = (q, res) => {
    if (q.path === "/api/tags") return json(res, { models: [{ name: "qwen2.5" }] });
    const msgs = q.body.messages!;
    if (!msgs.some((m) => m.role === "tool")) return nd(res, [{ model: "qwen2.5", message: { role: "assistant", content: "", tool_calls: [{ function: { name: "pipeline_stats", arguments: {} } }] }, done: false }, { done: true, eval_count: 3 }]);
    nd(res, [{ message: { content: "<think>hm</think>Pipeline " } }, "pas du json" as unknown as object, { message: { content: "vide." } }, { done: true, prompt_eval_count: 10, eval_count: 4 }]);
  };
  assert.deepEqual(await listModels(), ["qwen2.5"]);
  assert.equal((await aiStatus({ fresh: true })).online, true);
  const r = await runChat({ system: "S", history: [{ role: "user", content: "stats" }], send: () => {} });
  assert.equal(r.text, "Pipeline vide.");
  const second = srv.calls.filter((c) => c.path === "/api/chat")[1].body.messages!;
  const asst = second.find((m) => m.role === "assistant") as unknown as { tool_calls: { function: { name: string; arguments: object } }[] };
  assert.deepEqual(asst.tool_calls[0].function, { name: "pipeline_stats", arguments: {} });
  assert.ok(second.some((m) => m.role === "tool"));
  // Sortie structurée Ollama : schéma passé dans « format »
  srv.handle = (q, res) => { assert.deepEqual(q.body.format, JS.schema); json(res, { model: "qwen2.5", message: { role: "assistant", content: '{"resume":"ok","priorite":5}' }, done: true }); };
  assert.deepEqual((await structured({ messages: [{ role: "user", content: "x" }], schema: Schema, jsonSchema: JS })).data, { resume: "ok", priorite: 5 });
});
