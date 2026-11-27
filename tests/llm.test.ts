// Couche fournisseur IA (lib/llm.ts) contre un faux serveur compatible OpenAI (LM Studio) et un faux Ollama.
process.env.AI_ALLOWED_HOSTS = "127.0.0.1";   // le faux serveur écoute en local (refusé par défaut : protection SSRF)
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { db } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { insertBusiness } from "@/lib/crm";
import { listModels, aiStatus, resetAiStatus, chatStream, chat, structured, stripThink, ThinkFilter, extractJson, firstJsonObject, parseToolArgs, openaiBase, llmConfig, OFFLINE, aiCalls, resetModeRefusals } from "@/lib/llm";
import { runChat, MAX_TOOL_ROUNDS, type ChatEvent } from "@/lib/chat-run";
import { fakeLlm, closedPort, json, completion, sse, delta, lmsNative } from "./fake-llm";

let srv: Awaited<ReturnType<typeof fakeLlm>>;
before(async () => { srv = await fakeLlm(); });
after(async () => { await srv.close(); });
const useOpenai = (url = srv.base, key = "") => { setSetting("ia_provider", "openai"); setSetting("openai_url", url); setSetting("openai_model", "qwen/qwen3.5-4b"); setSetting("openai_key", key); setSetting("ia_mode", "tools"); resetAiStatus(); };
beforeEach(() => { srv.calls.length = 0; useOpenai(); resetModeRefusals(); setSetting("ia_params", ""); db.exec("DELETE FROM ai_calls; DELETE FROM businesses;"); });
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

test("sorties structurées : json_schema accepté ; refusé → json_object → texte + 1 nouvel essai ; mémorisé ; <think> retiré", async () => {
  srv.handle = (q, res) => {
    const rf = q.body.response_format as { type: string; json_schema: { name: string; strict: boolean } } | undefined;
    assert.deepEqual([q.body.stream, rf?.type, rf?.json_schema.name, rf?.json_schema.strict], [true, "json_schema", "test_schema", true]);
    completion(res, '<think>{"resume":"piège"}</think>{"resume":"Bon commerce","priorite":72}');
  };
  const a = await structured({ messages: [{ role: "system", content: "Analyse" }, { role: "user", content: "x" }], schema: Schema, jsonSchema: JS, task: "analyse" });
  assert.deepEqual([a.data, a.mode], [{ resume: "Bon commerce", priorite: 72 }, "json_schema"]);
  assert.equal(srv.calls.length, 1);

  // Serveur qui refuse tout response_format : json_schema (400) → json_object (400) → texte invalide → texte corrigé
  srv.calls.length = 0;
  let n = 0;
  srv.handle = (q, res) => {
    if (q.body.response_format) return json(res, { error: { message: `'response_format' of type '${(q.body.response_format as { type: string }).type}' is not supported` } }, 400);
    n++;
    assert.match(String(q.body.messages![0].content), /Réponds UNIQUEMENT avec un objet JSON/);
    if (n === 1) return completion(res, "Voici l'analyse : {pas du json");
    assert.match(String(q.body.messages!.at(-1)!.content), /n'est pas valide/);
    completion(res, '```json\n{"resume":"Deuxième essai","priorite":40}\n```');
  };
  const b = await structured({ messages: [{ role: "system", content: "Analyse" }, { role: "user", content: "x" }], schema: Schema, jsonSchema: JS });
  assert.deepEqual(b.data, { resume: "Deuxième essai", priorite: 40 });
  assert.deepEqual(srv.calls.map((c) => (c.body.response_format as { type?: string } | undefined)?.type ?? "texte"), ["json_schema", "json_object", "texte", "texte"]);
  // Refus mémorisés pour ce serveur : directement en texte
  srv.calls.length = 0;
  srv.handle = (q, res) => (q.body.response_format ? json(res, {}, 400) : completion(res, '{"resume":"r","priorite":1}'));
  await structured({ messages: [{ role: "user", content: "x" }], schema: Schema, jsonSchema: JS });
  assert.deepEqual([srv.calls.length, srv.calls[0].body.response_format], [1, undefined]);
  // Toujours invalide → erreur claire, chaque échec journalisé avec l'extrait brut
  srv.handle = (_q, res) => completion(res, "désolé, je ne peux pas");
  await assert.rejects(structured({ messages: [{ role: "user", content: "x" }], schema: Schema, jsonSchema: JS }), /illisible/);
  assert.match(aiCalls(1)[0].raw, /désolé/);
});

test("json_schema non respecté → json_object ; <think> jamais fermé ignoré ; bloc ```json et texte avant / après", async () => {
  srv.handle = (q, res) => {
    const t = (q.body.response_format as { type: string }).type;
    if (t === "json_schema") return completion(res, '<think>je pense que {"resume":"piège","priorite":1} puis je continue sans fermer');
    completion(res, 'Bien sûr ! Voici :\n```json\n{"resume":"Taller {centro} \\"Pérez\\"","priorite":3}\n```\nJ\'espère que ça aide {fin}');
  };
  const r = await structured({ messages: [{ role: "user", content: "x" }], schema: Schema, jsonSchema: JS });
  assert.deepEqual([r.data, r.mode], [{ resume: 'Taller {centro} "Pérez"', priorite: 3 }, "json_object"]);
  assert.match(aiCalls(5).find((c) => c.mode === "json_schema")!.error, /JSON invalide/);
  // Extraction : premier objet équilibré, accolades dans les chaînes, texte autour
  assert.deepEqual(firstJsonObject('Note {x} puis {"a":"}{","b":{"c":1}} fin }'), { a: "}{", b: { c: 1 } });
  assert.deepEqual(extractJson('<think>bla</think>\nRéponse : {"a":1} et {"b":2}'), { a: 1 });
  assert.throws(() => extractJson('<think>{"a":1} pas fermé'), /pas d'objet JSON/);
  assert.throws(() => extractJson('{"resume":"coupé au mil'), /incomplet/);
});

test("réponse coupée (finish_reason = length) : journalisée (fin, tokens, 500 caractères bruts) puis relancée une fois avec max_tokens doublé", async () => {
  srv.handle = (q, res) => (q.body.max_tokens === 50 ? completion(res, '{"resume":"Salón de uñas en Cancún con muchas reseñ', { finish_reason: "length" }) : completion(res, '{"resume":"Complet","priorite":9}'));
  const r = await structured({ messages: [{ role: "user", content: "x" }], schema: Schema, jsonSchema: JS, maxTokens: 50, task: "analyse" });
  assert.deepEqual(r.data, { resume: "Complet", priorite: 9 });
  assert.deepEqual(srv.calls.map((c) => [c.body.max_tokens, (c.body.response_format as { type: string }).type]), [[50, "json_schema"], [100, "json_schema"]]);
  const [ok, cut] = aiCalls(2);
  assert.deepEqual([cut.finish_reason, ok.finish_reason, cut.completion_tokens], ["length", "stop", 30]);
  assert.match(cut.error, /coupée/);
  assert.ok(cut.raw.startsWith('{"resume":"Salón de uñas'));
  assert.equal(ok.raw, "", "pas d'extrait brut quand tout va bien");
  // Coupée deux fois : on ne double qu'une fois, puis format suivant
  srv.calls.length = 0;
  srv.handle = (_q, res) => completion(res, '{"resume":"tronq', { finish_reason: "length" });
  await assert.rejects(structured({ messages: [{ role: "user", content: "x" }], schema: Schema, jsonSchema: JS, maxTokens: 40 }), /illisible/);
  assert.deepEqual(srv.calls.slice(0, 3).map((c) => c.body.max_tokens), [40, 80, 80]);
});

test("faux serveur LENT en streaming : génération qui avance pendant longtemps non coupée ; délai max par génération respecté ; vitesse mesurée", async () => {
  // Par défaut, échelle réduite (4 s au lieu de 4 min : mêmes rapports de délais). AI_SLOW_TEST=1 : la vraie durée de 4 min.
  const TOTAL = process.env.AI_SLOW_TEST ? 240_000 : 4_000;
  const json = '{"resume":"Génération lente mais complète","priorite":61}';
  const parts = json.match(/[\s\S]{1,2}/g)!;
  const step = TOTAL / parts.length;
  srv.handle = async (_q, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify(delta({ role: "assistant", reasoning_content: "…" }))}\n\n`);
    for (const p of parts) { await new Promise((r) => setTimeout(r, step)); if (res.destroyed) return; res.write(`data: ${JSON.stringify(delta({ content: p }))}\n\n`); }
    res.write(`data: ${JSON.stringify({ ...delta({}), choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`); res.write("data: [DONE]\n\n"); res.end();
  };
  const seen: number[] = [];
  const t0 = Date.now();
  const r = await structured({ messages: [{ role: "user", content: "x" }], schema: Schema, jsonSchema: JS, task: "analyse",
    deadlineMs: TOTAL * 2.5, idleMs: step * 4, onProgress: (p) => seen.push(p.tokens) });
  const took = Date.now() - t0;
  assert.equal(r.data.priorite, 61);
  assert.ok(took >= TOTAL * 0.95, `a duré ${took} ms (plus que l'ancien délai fixe équivalent)`);
  assert.ok(seen.length >= parts.length && seen.at(-1)! >= parts.length, "progression : tokens reçus au fil de l'eau");
  const log = aiCalls(1)[0];
  assert.ok(log.tokens_per_s! > 0 && log.ms >= TOTAL * 0.95 && log.finish_reason === "stop", JSON.stringify(log));
  // Même génération, mais délai max par génération plus court : coupée proprement, avec ce qui a été reçu
  const small = Math.round(TOTAL / 4);
  await assert.rejects(chat({ messages: [{ role: "user", content: "x" }], task: "analyse", deadlineMs: small, idleMs: step * 4 }), /délai max de génération dépassé/);
  const cut = aiCalls(1)[0];
  assert.match(cut.error, /délai max/);
  assert.ok(cut.raw.startsWith('{"resume"') && cut.out_tokens! > 0);
});

test("délais : inactivité (aucun token) ; la clé n'est jamais journalisée ; test de connexion toujours à 5 s", async () => {
  useOpenai(srv.base, "sk-secret-9999");
  process.env.AI_STREAM_IDLE_MS = "200";
  srv.handle = (_q, res) => { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write(`data: ${JSON.stringify(delta({ content: "Ho" }))}\n\n`); /* puis silence */ };
  const got: string[] = [];
  await assert.rejects((async () => { for await (const e of chatStream({ messages: [{ role: "user", content: "x" }] })) if (e.type === "token") got.push(e.text); })(), /aucune donnée reçue depuis 0 s|aucune donnée/);
  assert.deepEqual(got, ["Ho"]);
  delete process.env.AI_STREAM_IDLE_MS;
  const rows = JSON.stringify(db.prepare("SELECT * FROM ai_calls").all());
  assert.ok(rows.includes("aucune donnée"));
  assert.ok(!rows.includes("sk-secret"), "aucun secret dans le journal");
  // Réglages : délais par défaut
  const { iaParams } = await import("@/lib/llm");
  assert.deepEqual([iaParams().genTimeoutS, iaParams().manualTimeoutS, iaParams().streamIdleS], [600, 300, 120]);
});

test("LM Studio : raisonnement coupé via l'API native (POST /api/v1/chat, reasoning: \"off\") ; repli /v1 si refusée", async () => {
  srv.handle = (q, res) => {
    if (q.path === "/api/v1/chat") {
      assert.deepEqual([q.body.reasoning, q.body.stream, q.body.store, q.body.max_output_tokens, q.body.model], ["off", true, false, 300, "qwen/qwen3.5-4b"]);
      assert.match(String(q.body.system_prompt), /Analyse[\s\S]*Réponds UNIQUEMENT/);
      return lmsNative(res, 'Voici : {"resume":"Natif","priorite":77}', { reasoning: "pas affiché" });
    }
    completion(res, '{"resume":"compat","priorite":1}');
  };
  const prog: number[] = [];
  const r = await structured({ messages: [{ role: "system", content: "Analyse" }, { role: "user", content: "x" }], schema: Schema, jsonSchema: JS, maxTokens: 300, reasoningOff: true, task: "analyse", onProgress: (p) => prog.push(p.reasoning) });
  assert.deepEqual([r.data, r.mode, srv.calls[0].path], [{ resume: "Natif", priorite: 77 }, "native", "/api/v1/chat"]);
  assert.equal(prog.at(-1), 1, "raisonnement compté, jamais affiché");
  const log = aiCalls(1)[0];
  assert.deepEqual([log.mode, log.tokens_per_s, log.prompt_tokens, log.completion_tokens], ["native", 8.5, 900, 40]);
  // Ancien LM Studio / autre serveur : /api/v1/chat absent (404) → /v1/chat/completions json_schema, refus mémorisé
  srv.calls.length = 0;
  srv.handle = (q, res) => (q.path === "/api/v1/chat" ? json(res, { error: "Unexpected endpoint" }, 404) : completion(res, '{"resume":"compat","priorite":2}'));
  const r2 = await structured({ messages: [{ role: "user", content: "x" }], schema: Schema, jsonSchema: JS, reasoningOff: true });
  assert.deepEqual([r2.mode, srv.calls.map((c) => c.path)], ["json_schema", ["/api/v1/chat", "/v1/chat/completions"]]);
  srv.calls.length = 0;
  await structured({ messages: [{ role: "user", content: "x" }], schema: Schema, jsonSchema: JS, reasoningOff: true });
  assert.deepEqual(srv.calls.map((c) => c.path), ["/v1/chat/completions"]);
  // Réglage « seulement /no_think » : jamais l'API native
  resetModeRefusals(); srv.calls.length = 0;
  setSetting("ia_params", JSON.stringify({ lmsNative: "off" }));
  await structured({ messages: [{ role: "user", content: "x" }], schema: Schema, jsonSchema: JS, reasoningOff: true });
  assert.deepEqual(srv.calls.map((c) => c.path), ["/v1/chat/completions"]);
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
