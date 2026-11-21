import { getSetting } from "./settings";
import { waNumber } from "./phone";
import { dayOf } from "./db";
import type { Business } from "./crm";

export type TplKey = "first" | "j2" | "j7";
export const TEMPLATES: { key: TplKey; label: string; setting: "tpl_first" | "tpl_j2" | "tpl_j7" }[] = [
  { key: "first", label: "Premier message", setting: "tpl_first" },
  { key: "j2", label: "Relance J+2", setting: "tpl_j2" },
  { key: "j7", label: "Relance J+7", setting: "tpl_j7" },
];
export const MAX_WA_TEXT = 4000;

/** Modèle conseillé selon l'état du commerce (premier contact / relance J+2 / relance J+7). */
export function suggestedTemplate(b: Business): TplKey {
  if (!b.first_contact_at) return "first";
  const days = Math.round((Date.parse(dayOf() + "T12:00:00Z") - Date.parse(dayOf(new Date(b.first_contact_at)) + "T12:00:00Z")) / 86400000);
  return days >= 7 ? "j7" : "j2";
}

/** Premier message : le message personnalisé de la fiche s'il existe, sinon le modèle des Réglages. Relances : modèles des Réglages. */
export function messageFor(b: Pick<Business, "nom" | "message_whatsapp">, tpl: TplKey): { text: string; custom: boolean } {
  const custom = tpl === "first" && !!b.message_whatsapp?.trim();
  const raw = custom ? b.message_whatsapp : getSetting(TEMPLATES.find((t) => t.key === tpl)!.setting);
  return { text: raw.replaceAll("{nom}", b.nom).trim(), custom };
}

export function buildWaUrl(b: Business, tpl: TplKey, text?: string): string | null {
  const num = waNumber(b.whatsapp || b.telephone);
  if (!num) return null;
  const t = (text ?? messageFor(b, tpl).text).trim().slice(0, MAX_WA_TEXT);
  return `https://wa.me/${num}` + (t ? `?text=${encodeURIComponent(t)}` : "");
}
