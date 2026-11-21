import { NextResponse } from "next/server";
import { z } from "zod";
import { getBusiness, logAction, dayCounts } from "@/lib/crm";
import { buildWaUrl, messageFor, suggestedTemplate, MAX_WA_TEXT, TEMPLATES } from "@/lib/whatsapp";
import { DAILY_WHATSAPP } from "@/lib/constants";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({
  id: zId,
  template: z.enum(["first", "j2", "j7"]).optional(),
  prepare: z.boolean().default(false),        // true : renvoie seulement le message proposé (rien n'est journalisé)
  text: z.string().max(MAX_WA_TEXT).optional(), // message modifié par l'utilisateur avant ouverture de wa.me
});

// 1) prepare : message proposé (modifiable). 2) envoi : vérifie la limite du jour, journalise « WhatsApp envoyé »
// (ce qui incrémente le compteur) et renvoie l'URL wa.me avec le texte final.
export const POST = route(async (req) => {
  await requireSession();
  const { id, template, prepare, text } = await readJson(req, Body);
  const b = getBusiness(id);
  if (!b) return NextResponse.json({ error: "Commerce introuvable" }, { status: 404 });
  const sent = dayCounts().whatsapp;
  if (sent >= DAILY_WHATSAPP) {
    return NextResponse.json({ error: `Limite atteinte : ${DAILY_WHATSAPP} messages WhatsApp aujourd'hui. Reprends demain.` }, { status: 429 });
  }
  const tpl = template ?? suggestedTemplate(b);
  if (!buildWaUrl(b, tpl, "")) return NextResponse.json({ error: "Numéro mexicain invalide ou manquant." }, { status: 400 });
  if (prepare) {
    const m = messageFor(b, tpl);
    return NextResponse.json({ template: tpl, text: m.text, custom: m.custom, remaining: DAILY_WHATSAPP - sent,
      label: TEMPLATES.find((t) => t.key === tpl)!.label });
  }
  const url = buildWaUrl(b, tpl, text);
  logAction(b.id, "whatsapp", { first: "Premier message", j2: "Relance J+2", j7: "Relance J+7" }[tpl]);
  return NextResponse.json({ url });
});
