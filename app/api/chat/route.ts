import { db, now } from "@/lib/db";
import { getSetting, systemPrompt } from "@/lib/settings";
import { OFFLINE, type LlmMsg } from "@/lib/llm";
import { runChat } from "@/lib/chat-run";
import type { Proposal } from "@/lib/ai-tools";
import { z } from "zod";
import { readJson, route, zId } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

const Body = z.object({ conversationId: zId.optional(), message: z.string().trim().min(1, "message vide").max(8000) });

export const dynamic = "force-dynamic";
export const maxDuration = 900;

// Réponse en streaming NDJSON : {t:'conv'|'token'|'replace'|'tool'|'notice'|'proposals'|'error'|'done', ...}
// Aucune requête IA depuis le navigateur : tout passe par ce serveur (lib/llm.ts).
export const POST = route(async (req) => {
  await requireSession();
  const { conversationId, message } = await readJson(req, Body);
  if (conversationId && !db.prepare("SELECT 1 FROM conversations WHERE id=?").get(conversationId)) throw new HttpError(400, "Conversation introuvable.");
  const t = now();
  let convId = conversationId;
  if (!convId) {
    convId = Number(db.prepare("INSERT INTO conversations(title,created_at,updated_at) VALUES(?,?,?)").run(message.slice(0, 60), t, t).lastInsertRowid);
  }
  db.prepare("INSERT INTO messages(conversation_id,role,content,created_at) VALUES(?,?,?,?)").run(convId, "user", message, t);
  const history = (db.prepare("SELECT role, content FROM messages WHERE conversation_id=? AND role IN ('user','assistant') ORDER BY id").all(convId) as LlmMsg[]).slice(-30);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: object) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      send({ t: "conv", id: convId });
      let text = "";
      let proposals: Proposal[] = [];
      try {
        const r = await runChat({ system: systemPrompt(), history, mode: getSetting("ia_mode") === "context" ? "context" : "tools", send });
        text = r.text; proposals = r.proposals;
      } catch (e) {
        const m = (e as Error).message;
        send({ t: "error", v: m === OFFLINE ? OFFLINE : m });
        if (!text) text = "⚠️ " + m;
      }
      const id = Number(db.prepare("INSERT INTO messages(conversation_id,role,content,proposals,created_at) VALUES(?,?,?,?,?)")
        .run(convId, "assistant", text, proposals.length ? JSON.stringify(proposals) : null, now()).lastInsertRowid);
      db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(now(), convId);
      if (proposals.length) send({ t: "proposals", messageId: id, items: proposals });
      send({ t: "done" });
      ctrl.close();
    },
  });
  // X-Accel-Buffering : demande aux proxys (Nginx, OpenLiteSpeed) de ne pas mettre la réponse en tampon.
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
});
