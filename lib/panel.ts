// Données envoyées aux boutons de résultat (composant client ResultPanel) pour une fiche.
import type { Business } from "./crm";
import { messageFor } from "./whatsapp";
import { waNumber } from "./phone";
import { stageOf, type Stage } from "./stage";
import { aiDraftFor } from "./ai-draft";
import type { PanelItem } from "@/components/ResultPanel";

/**
 * Message proposé selon l'étape : premier message (message de la fiche, sinon brouillon IA, sinon modèle), relances
 * J+2 / J+7 ; rien en conversation. Le brouillon IA est signalé (badge « IA ») et reste modifiable avant l'envoi.
 */
export function panelItem(b: Business, opts: { stage?: Stage; hardLeft?: number; hard?: number } = {}): PanelItem {
  const stage = opts.stage ?? stageOf(b);
  const template = stage === "new" ? "first" : stage === "j2" ? "j2" : stage === "j7" || stage === "fin" ? "j7" : null;
  const blocked = b.ne_pas_contacter ? "Fiche marquée « Ne pas contacter » : aucun WhatsApp (retire le marquage sur la fiche)." : stage === "new" && opts.hardLeft !== undefined && opts.hardLeft <= 0
    ? `Limite dure atteinte (${opts.hard ?? ""} nouveaux WhatsApp aujourd'hui) : reprends demain ou ajuste Réglages › Ma prospection.` : undefined;
  const draft = template === "first" && !b.message_whatsapp?.trim() ? aiDraftFor(b.id) : "";
  return {
    id: b.id, nom: b.nom, stage, template,
    waNumber: waNumber(b.whatsapp || b.telephone),
    waText: draft || (template ? messageFor(b, template).text : ""),
    aiDraft: !!draft,
    tel: b.tel_norm ? `tel:+52${b.tel_norm}` : "",
    waBlocked: blocked, noWhatsapp: !!b.no_whatsapp,
  };
}
