// Tour de chat (assistant du CRM) via la couche fournisseur : streaming, tool calling (5 tours max), repli
// automatique sur le mode « contexte injecté » si le modèle ou le serveur gère mal les outils.
// Les outils d'écriture ne font que PROPOSER (bouton « Appliquer » côté utilisateur).
import { chatStream, llmConfig, LlmHttpError, parseToolArgs, type LlmConfig, type LlmMsg, type ToolCall } from "./llm";
import { TOOLS, WRITE_TOOLS, runReadTool, makeProposal, contextBlock, type Proposal } from "./ai-tools";

export const MAX_TOOL_ROUNDS = 5;
export type ChatEvent = { t: "token"; v: string } | { t: "tool"; name: string } | { t: "replace"; v: string } | { t: "notice"; v: string };

/**
 * `history` : messages user / assistant de la conversation. `send` reçoit les événements au fil de l'eau.
 * Renvoie le texte final (raisonnement retiré) et les propositions d'écriture en attente de validation.
 */
export async function runChat(opts: { system: string; history: LlmMsg[]; mode?: "tools" | "context"; send: (e: ChatEvent) => void; config?: LlmConfig }): Promise<{ text: string; proposals: Proposal[] }> {
  const c = opts.config ?? llmConfig();
  let useTools = opts.mode !== "context" && c.provider !== "n8n";
  const sysFor = (tools: boolean) => opts.system + (tools ? "" : contextBlock());
  let msgs: LlmMsg[] = [{ role: "system", content: sysFor(useTools) }, ...opts.history];
  const proposals: Proposal[] = [];
  let text = "", shown = "", badRounds = 0;

  const fallback = (why: string) => {
    useTools = false;
    msgs = [{ role: "system", content: sysFor(false) }, ...opts.history];
    text = ""; if (shown) { shown = ""; opts.send({ t: "replace", v: "" }); }
    opts.send({ t: "notice", v: why });
  };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const tools = useTools && round < MAX_TOOL_ROUNDS ? TOOLS : undefined;   // dernier tour : réponse sans outils
    let calls: ToolCall[] = [], content = "", streamed = "";
    try {
      for await (const ev of chatStream({ messages: msgs, tools, task: "chat" }, c)) {
        if (ev.type === "token") { streamed += ev.text; shown += ev.text; opts.send({ t: "token", v: ev.text }); }
        else { calls = ev.result.toolCalls; content = ev.result.content; }
      }
    } catch (e) {
      // Le serveur refuse les outils (400 « tools not supported »…) : on repasse en mode contexte, une fois.
      if (tools && e instanceof LlmHttpError && !streamed) { fallback("Le modèle ne gère pas les outils : données du CRM injectées dans le message."); round = -1; continue; }
      throw e;
    }
    // Raisonnement sans balise ouvrante (« … </think> réponse ») : on remplace le texte affiché par la version nettoyée.
    if (content !== streamed.trim() && streamed) { shown = text + content; opts.send({ t: "replace", v: shown }); }
    text += content;
    if (!calls.length || !tools) break;
    msgs.push({ role: "assistant", content, tool_calls: calls });
    let invalid = 0;
    for (const call of calls) {
      opts.send({ t: "tool", name: call.name });
      const parsed = parseToolArgs(call.arguments);
      let out: string;
      if (!parsed.ok) { invalid++; out = JSON.stringify({ error: `Appel de ${call.name} refusé : ${parsed.error}. Renvoie des arguments JSON valides.` }); }
      else if (WRITE_TOOLS.includes(call.name)) { proposals.push(makeProposal(call.name, parsed.args)); out = "Proposition enregistrée ; elle sera appliquée seulement si l'utilisateur confirme."; }
      else if (TOOLS.some((t) => t.function.name === call.name)) out = JSON.stringify(runReadTool(call.name, parsed.args)).slice(0, 12000);
      else { invalid++; out = JSON.stringify({ error: "Outil inconnu : " + call.name }); }
      msgs.push({ role: "tool", tool_call_id: call.id, name: call.name, content: out });
    }
    // Deux tours de suite où tous les appels sont invalides : le modèle gère mal les outils → mode contexte.
    badRounds = invalid === calls.length ? badRounds + 1 : 0;
    if (badRounds >= 2) { fallback("Appels d'outils invalides : données du CRM injectées dans le message."); round = -1; badRounds = 0; }
  }
  return { text: text.trim(), proposals };
}
