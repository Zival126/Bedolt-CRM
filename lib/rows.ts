// Ligne de file (Aujourd'hui / mode focus) : infos affichées + données des boutons de résultat.
import type { Business } from "./crm";
import { panelItem } from "./panel";
import { STAGE_LABEL, type Stage } from "./stage";
import { today, dayOf } from "./db";
import type { PanelItem } from "@/components/ResultPanel";

export type QueueRow = {
  qid: number; id: number; nom: string; niche: string; zone: string; ville: string; offre: string;
  note: number | null; avis: number | null; angle: string; stage: Stage; stageLabel: string; info: string; panel: PanelItem;
};

const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC", day: "numeric", month: "short" });

export function stageInfo(b: Business, stage: Stage, day = today()): string {
  if (stage === "j2" || stage === "j7" || stage === "fin") {
    const late = b.next_followup && b.next_followup < day ? Math.round((Date.parse(day) - Date.parse(b.next_followup)) / 86400000) : 0;
    const first = b.first_contact_at ? "1er contact le " + fmt(dayOf(new Date(b.first_contact_at))) : "";
    return [first, late ? `en retard de ${late} j` : ""].filter(Boolean).join(" · ");
  }
  if (stage === "rappel") return b.next_date ? "rappel prévu le " + fmt(b.next_date) : "";
  if (stage === "etape") return [b.next_step, b.next_date ? "le " + fmt(b.next_date) : ""].filter(Boolean).join(" · ");
  if (stage === "reponse") return "a répondu · sans suite";
  return "";
}

export function queueRow(qid: number, b: Business, stage: Stage, opts: { hardLeft?: number; hard?: number } = {}): QueueRow {
  return {
    qid, id: b.id, nom: b.nom, niche: b.niche || b.activite, zone: b.zone, ville: b.ville, offre: b.offre,
    note: b.note_google, avis: b.nb_avis, angle: b.angle, stage, stageLabel: STAGE_LABEL[stage], info: stageInfo(b, stage),
    panel: panelItem(b, { stage, ...opts }),
  };
}
