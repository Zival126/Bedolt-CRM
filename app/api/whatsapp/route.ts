import { NextResponse } from "next/server";
import { z } from "zod";
import { getBusiness, dayCounts } from "@/lib/crm";
import { messageFor, suggestedTemplate, MAX_WA_TEXT, TEMPLATES } from "@/lib/whatsapp";
import { objectives } from "@/lib/settings";
import { waNumber } from "@/lib/phone";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({
  id: zId,
  template: z.enum(["first", "j2", "j7"]).optional(),
});

// Prépare un WhatsApp : message proposé (personnalisé de la fiche ou modèle des Réglages) + numéro wa.me.
// Rien n'est journalisé ici : l'envoi est enregistré quand l'utilisateur confirme « Envoyé ? » (/api/result, wa_sent).
// Blocage serveur : un premier message à un prospect « À contacter » est refusé au-delà de la limite dure du jour.
export const POST = route(async (req) => {
  await requireSession();
  const { id, template } = await readJson(req, Body);
  const b = getBusiness(id);
  if (!b) return NextResponse.json({ error: "Commerce introuvable" }, { status: 404 });
  if (b.statut === "perdu") return NextResponse.json({ error: "Fiche perdue : réactive-la d'abord." }, { status: 400 });
  const number = waNumber(b.whatsapp || b.telephone);
  if (!number) return NextResponse.json({ error: "Numéro mexicain invalide ou manquant." }, { status: 400 });
  const tpl = template ?? suggestedTemplate(b);
  const o = objectives();
  const sent = dayCounts().newWa;
  const isNew = b.statut === "a_contacter";
  if (isNew && sent >= o.newHard) {
    return NextResponse.json({ error: `Limite dure atteinte : ${o.newHard} nouveaux WhatsApp aujourd'hui. Reprends demain (ou ajuste Réglages > Objectifs).` }, { status: 429 });
  }
  const m = messageFor(b, tpl);
  return NextResponse.json({ template: tpl, text: m.text.slice(0, MAX_WA_TEXT), custom: m.custom, number, isNew,
    remaining: isNew ? o.newHard - sent : null, label: TEMPLATES.find((t) => t.key === tpl)!.label });
});
