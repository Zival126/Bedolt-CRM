import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const rows = db.prepare("SELECT id, role, content, proposals FROM messages WHERE conversation_id=? ORDER BY id").all(Number(id)) as { proposals: string | null }[];
    return NextResponse.json({ messages: rows.map((r) => ({ ...r, proposals: r.proposals ? JSON.parse(r.proposals) : [] })) });
  }
  return NextResponse.json({ conversations: db.prepare("SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 30").all() });
}
export async function DELETE(req: Request) {
  db.prepare("DELETE FROM conversations WHERE id=?").run(Number(new URL(req.url).searchParams.get("id")));
  return NextResponse.json({ ok: true });
}
