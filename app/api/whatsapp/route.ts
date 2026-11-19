import { NextResponse } from "next/server";
import { z } from "zod";
import { getBusiness, logAction, dayCounts } from "@/lib/crm";
import { buildWaUrl, suggestedTemplate } from "@/lib/whatsapp";
import { DAILY_WHATSAPP } from "@/lib/constants";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({ id: zId, template: z.enum(["first", "j2", "j7"]).optional() });

// Un clic = vérifie la limite du jour, journalise « WhatsApp envoyé » (ce qui incrémente le compteur) et renvoie l'URL wa.me.
export const POST = route(async (req) => {
  await requireSession();
  const { id, template } = await readJson(req, Body);
  const b = getBusiness(id);
  if (!b) return NextResponse.json({ error: "Commerce introuvable" }, { status: 404 });
  if (dayCounts().whatsapp >= DAILY_WHATSAPP) {
    return NextResponse.json({ error: `Limite atteinte : ${DAILY_WHATSAPP} messages WhatsApp aujourd'hui. Reprends demain.` }, { status: 429 });
  }
  const tpl = template ?? suggestedTemplate(b);
  const url = buildWaUrl(b, tpl);
  if (!url) return NextResponse.json({ error: "Numéro mexicain invalide ou manquant." }, { status: 400 });
  logAction(b.id, "whatsapp", { first: "Premier message", j2: "Relance J+2", j7: "Relance J+7" }[tpl]);
  return NextResponse.json({ url });
});
