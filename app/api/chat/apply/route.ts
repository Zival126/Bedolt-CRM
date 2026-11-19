import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { applyProposal, type Proposal } from "@/lib/ai-tools";
import { revalidatePath } from "next/cache";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({ messageId: zId, proposalId: z.string().min(1).max(40), action: z.enum(["apply", "reject"]) });

// Bouton « Appliquer » (ou « Ignorer ») sur une modification proposée par l'IA.
export const POST = route(async (req) => {
  await requireSession();
  const { messageId, proposalId, action } = await readJson(req, Body);
  const row = db.prepare("SELECT proposals FROM messages WHERE id=?").get(messageId) as { proposals: string | null } | undefined;
  let list: Proposal[] = [];
  try { list = row?.proposals ? JSON.parse(row.proposals) : []; } catch { list = []; }
  const p = list.find((x) => x.id === proposalId);
  if (!p || p.status !== "pending") return NextResponse.json({ error: "Proposition introuvable ou déjà traitée." }, { status: 400 });
  try {
    if (action === "apply") applyProposal(p);
    p.status = action === "apply" ? "applied" : "rejected";
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  db.prepare("UPDATE messages SET proposals=? WHERE id=?").run(JSON.stringify(list), messageId);
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, status: p.status });
});
