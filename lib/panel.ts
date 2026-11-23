// Données envoyées aux boutons de résultat (composant client ResultPanel) pour une fiche.
import type { Business } from "./crm";
import { messageFor } from "./whatsapp";
import { waNumber } from "./phone";
import { stageOf, type Stage } from "./stage";
import type { PanelItem } from "@/components/ResultPanel";

/** Message proposé selon l'étape : premier message (fiche, sinon modèle), relances J+2 / J+7 ; rien en conversation. */
export function panelItem(b: Business, opts: { stage?: Stage; hardLeft?: number; hard?: number } = {}): PanelItem {
  const stage = opts.stage ?? stageOf(b);
  const template = stage === "new" ? "first" : stage === "j2" ? "j2" : stage === "j7" || stage === "fin" ? "j7" : null;
  const blocked = stage === "new" && opts.hardLeft !== undefined && opts.hardLeft <= 0
    ? `Limite dure atteinte (${opts.hard ?? ""} nouveaux WhatsApp aujourd'hui) : reprends demain ou ajuste Réglages > Objectifs.` : undefined;
  return {
    id: b.id, nom: b.nom, stage, template,
    waNumber: waNumber(b.whatsapp || b.telephone),
    waText: template ? messageFor(b, template).text : "",
    tel: b.tel_norm ? `tel:+52${b.tel_norm}` : "",
    waBlocked: blocked, noWhatsapp: !!b.no_whatsapp,
  };
}
