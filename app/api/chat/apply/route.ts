import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyProposal, type Proposal } from "@/lib/ai-tools";
import { revalidatePath } from "next/cache";

// Bouton « Appliquer » (ou « Ignorer ») sur une modification proposée par l'IA.
export async function POST(req: Request) {
  const { messageId, proposalId, action } = (await req.json()) as { messageId: number; proposalId: string; action: "apply" | "reject" };
  const row = db.prepare("SELECT proposals FROM messages WHERE id=?").get(messageId) as { proposals: string | null } | undefined;
  const list: Proposal[] = row?.proposals ? JSON.parse(row.proposals) : [];
  const p = list.find((x) => x.id === proposalId);
  if (!p || p.status !== "pending") return NextResponse.json({ error: "Proposition introuvable ou déjà traitée." }, { status: 400 });
  try {
    if (action === "apply") applyProposal(p);
    p.status = action === "apply" ? "applied" : "rejected";
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  db.prepare("UPDATE messages SET proposals=? WHERE id=?").run(JSON.stringify(list), messageId);
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, status: p.status });
}
