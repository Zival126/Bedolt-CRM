import { NextResponse } from "next/server";
import { getBusiness, logAction, dayCounts } from "@/lib/crm";
import { buildWaUrl, suggestedTemplate, type TplKey } from "@/lib/whatsapp";
import { DAILY_WHATSAPP } from "@/lib/constants";

// Un clic = vérifie la limite du jour, journalise « WhatsApp envoyé » (ce qui incrémente le compteur) et renvoie l'URL wa.me.
export async function POST(req: Request) {
  const { id, template } = (await req.json()) as { id: number; template?: TplKey };
  const b = getBusiness(Number(id));
  if (!b) return NextResponse.json({ error: "Commerce introuvable" }, { status: 404 });
  if (dayCounts().whatsapp >= DAILY_WHATSAPP) {
    return NextResponse.json({ error: `Limite atteinte : ${DAILY_WHATSAPP} messages WhatsApp aujourd'hui. Reprends demain.` }, { status: 429 });
  }
  const tpl = template ?? suggestedTemplate(b);
  const url = buildWaUrl(b, tpl);
  if (!url) return NextResponse.json({ error: "Numéro mexicain invalide ou manquant." }, { status: 400 });
  logAction(b.id, "whatsapp", { first: "Premier message", j2: "Relance J+2", j7: "Relance J+7" }[tpl]);
  return NextResponse.json({ url });
}
