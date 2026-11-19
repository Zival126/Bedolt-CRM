import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parse, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Query = z.object({ id: zId.optional() });
const query = (req: Request) => parse(Query, Object.fromEntries(new URL(req.url).searchParams));
const safeJson = (s: string | null) => { try { return s ? JSON.parse(s) : []; } catch { return []; } };

export const GET = route(async (req) => {
  await requireSession();
  const { id } = query(req);
  if (id) {
    const rows = db.prepare("SELECT id, role, content, proposals FROM messages WHERE conversation_id=? ORDER BY id").all(id) as { proposals: string | null }[];
    return NextResponse.json({ messages: rows.map((r) => ({ ...r, proposals: safeJson(r.proposals) })) });
  }
  return NextResponse.json({ conversations: db.prepare("SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 30").all() });
});
export const DELETE = route(async (req) => {
  await requireSession();
  const { id } = parse(z.object({ id: zId }), Object.fromEntries(new URL(req.url).searchParams));
  db.prepare("DELETE FROM conversations WHERE id=?").run(id);
  return NextResponse.json({ ok: true });
});
