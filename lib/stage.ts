// Étape d'un prospect dans le cycle d'action (sans accès à la base : utilisable côté client).

export type Stage = "new" | "j2" | "j7" | "fin" | "reponse" | "rappel" | "etape" | "perdu" | "paye";
export type Block = "reponses" | "relances" | "nouveaux";

export const STAGE_LABEL: Record<Stage, string> = {
  new: "Nouveau", j2: "Relance J+2", j7: "Relance J+7", fin: "Sans réponse", reponse: "Réponse",
  rappel: "À rappeler", etape: "Étape prévue", perdu: "Perdu", paye: "Payé",
};

/** Étape à journaliser avec une action (step) : first | j2 | j7 | fin | reponse | rappel | etape. */
export const STEP_OF: Record<Stage, string> = {
  new: "first", j2: "j2", j7: "j7", fin: "fin", reponse: "reponse", rappel: "rappel", etape: "etape", perdu: "", paye: "",
};

type S = { statut: string; relance_n: number | null; next_date: string | null };

export function stageOf(b: S): Stage {
  switch (b.statut) {
    case "a_contacter": return "new";
    case "contacte": return (b.relance_n ?? 0) <= 0 ? "j2" : b.relance_n === 1 ? "j7" : "fin";
    case "a_repondu": return b.next_date ? "rappel" : "reponse";
    case "interesse": return "etape";
    case "paye": return "paye";
    default: return "perdu";
  }
}

/** Modèle de message WhatsApp adapté à l'étape. */
export const templateFor = (st: Stage): "first" | "j2" | "j7" => (st === "new" ? "first" : st === "j2" ? "j2" : st === "j7" || st === "fin" ? "j7" : "first");

/** Résultats acceptés par /api/result. */
export const RESULTS = ["wa_sent", "no_wa", "repondu", "pas_repondu", "interesse", "etape", "rappel", "perdu", "reactiver", "paye", "reporter"] as const;
export type Result = (typeof RESULTS)[number];

export const MAX_WA_TEXT = 4000;
/** Lien wa.me (numéro 52 + 10 chiffres) ; '' si le numéro est invalide. */
export const waUrl = (num: string, text: string) =>
  num ? `https://wa.me/${num}` + (text.trim() ? `?text=${encodeURIComponent(text.trim().slice(0, MAX_WA_TEXT))}` : "") : "";
