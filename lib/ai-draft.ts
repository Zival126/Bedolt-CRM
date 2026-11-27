// Brouillon IA du premier message (proposition non encore validée) : affiché dans Aujourd'hui et le mode focus,
// modifiable avant l'envoi. Rien n'est envoyé : WhatsApp s'ouvre et c'est toi qui envoies.
import { db } from "./db";

/** Brouillon IA prêt (fait, non ignoré, pas encore copié dans la fiche), ou "". */
export function aiDraftFor(id: number): string {
  const r = db.prepare("SELECT draft_message d FROM ai_outputs WHERE business_id = ? AND status = 'fait' AND draft_message != '' AND used_at IS NULL").get(id) as { d: string } | undefined;
  return r?.d ?? "";
}
