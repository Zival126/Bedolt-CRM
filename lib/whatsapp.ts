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

/** Modèle conseillé selon l'état du commerce (premier contact / relance J+2 / relance J+7). */
export function suggestedTemplate(b: Business): TplKey {
  if (!b.first_contact_at) return "first";
  const days = Math.round((Date.parse(dayOf() + "T12:00:00Z") - Date.parse(dayOf(new Date(b.first_contact_at)) + "T12:00:00Z")) / 86400000);
  return days >= 7 ? "j7" : "j2";
}

export function buildWaUrl(b: Business, tpl: TplKey): string | null {
  const num = waNumber(b.whatsapp || b.telephone);
  if (!num) return null;
  const setting = TEMPLATES.find((t) => t.key === tpl)!.setting;
  const text = getSetting(setting).replaceAll("{nom}", b.nom).trim();
  return `https://wa.me/${num}` + (text ? `?text=${encodeURIComponent(text)}` : "");
}
