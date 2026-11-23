import { z } from "zod";
import { runSearch, SearchParamsSchema, existingIndex } from "@/lib/denue-run";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({ params: SearchParamsSchema });

/**
 * Recherche DENUE complète, en flux NDJSON : {type:"progress"} pendant la pagination, puis {type:"done", rows}.
 * Chaque ligne porte `existing` (fiche du CRM : CLEE, puis téléphone, puis nom à moins de 100 m) ou null.
 * Une erreur en cours de route renvoie ce qui a été lu + `partial` (relancer reprend grâce au cache 24 h).
 */
export const POST = route(async (req) => {
  await requireSession();
  const { params } = await readJson(req, Body);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: object) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const r = await runSearch(params, (p) => send({ type: "progress", ...p }));
        const find = existingIndex();
        send({ type: "done", expected: r.expected, requests: r.requests, partial: r.partial ?? null,
          rows: r.rows.map((x) => ({ ...x, existing: find(x) })) });
      } catch (e) {
        send({ type: "error", error: (e as Error).message });
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
});
