import { db, now } from "@/lib/db";
import { getSetting, systemPrompt } from "@/lib/settings";
import { provider, ollamaStream, n8nAsk, OFFLINE, type Msg, type ToolCall } from "@/lib/ai";
import { TOOLS, WRITE_TOOLS, runReadTool, makeProposal, parseArgs, contextBlock, type Proposal } from "@/lib/ai-tools";

export const dynamic = "force-dynamic";

// Réponse en streaming NDJSON : {t:'conv'|'token'|'tool'|'proposals'|'error'|'done', ...}
export async function POST(req: Request) {
  const { conversationId, message } = (await req.json()) as { conversationId?: number; message: string };
  const t = now();
  let convId = conversationId;
  if (!convId) {
    convId = Number(db.prepare("INSERT INTO conversations(title,created_at,updated_at) VALUES(?,?,?)").run(message.slice(0, 60), t, t).lastInsertRowid);
  }
  db.prepare("INSERT INTO messages(conversation_id,role,content,created_at) VALUES(?,?,?,?)").run(convId, "user", message, t);
  const history = (db.prepare("SELECT role, content FROM messages WHERE conversation_id=? AND role IN ('user','assistant') ORDER BY id").all(convId) as Msg[]).slice(-30);
  const useTools = getSetting("ia_mode") !== "context" && provider() === "ollama";

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: object) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      send({ t: "conv", id: convId });
      let text = "";
      const proposals: Proposal[] = [];
      try {
        const sys = systemPrompt() + (useTools ? "" : contextBlock());
        if (provider() === "n8n") {
          text = await n8nAsk({ system: sys, message, history });
          send({ t: "token", v: text });
        } else {
          const msgs: Msg[] = [{ role: "system", content: sys }, ...history];
          for (let round = 0; round < 6; round++) {
            const calls: ToolCall[] = [];
            let roundText = "";
            for await (const chunk of ollamaStream(msgs, useTools ? TOOLS : undefined)) {
              const m = chunk.message;
              if (m?.content) { roundText += m.content; send({ t: "token", v: m.content }); }
              if (m?.tool_calls) calls.push(...m.tool_calls);
            }
            text += roundText;
            if (!calls.length) break;
            msgs.push({ role: "assistant", content: roundText, tool_calls: calls });
            for (const c of calls) {
              const name = c.function.name, args = parseArgs(c.function.arguments);
              send({ t: "tool", name });
              if (WRITE_TOOLS.includes(name)) {
                proposals.push(makeProposal(name, args));
                msgs.push({ role: "tool", content: "Proposition enregistrée ; elle sera appliquée seulement si l'utilisateur confirme." });
              } else {
                msgs.push({ role: "tool", content: JSON.stringify(runReadTool(name, args)).slice(0, 12000) });
              }
            }
          }
        }
      } catch (e) {
        const m = (e as Error).message;
        send({ t: "error", v: m === OFFLINE ? OFFLINE : m });
        if (!text) text = m === OFFLINE ? "⚠️ " + OFFLINE : "⚠️ " + m;
      }
      const id = Number(db.prepare("INSERT INTO messages(conversation_id,role,content,proposals,created_at) VALUES(?,?,?,?,?)")
        .run(convId, "assistant", text, proposals.length ? JSON.stringify(proposals) : null, now()).lastInsertRowid);
      db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(now(), convId);
      if (proposals.length) send({ t: "proposals", messageId: id, items: proposals });
      send({ t: "done" });
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
