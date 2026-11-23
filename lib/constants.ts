export const STATUTS = [
  { key: "a_contacter", label: "À contacter" },
  { key: "contacte", label: "Contacté" },
  { key: "a_repondu", label: "A répondu" },
  { key: "interesse", label: "Intéressé" },
  { key: "paye", label: "Payé" },
  { key: "perdu", label: "Perdu" },
] as const;
export type Statut = (typeof STATUTS)[number]["key"];
/** « pas_interesse » : ancien statut (avant la v3), conservé tel quel dans l'historique. */
export const statutLabel = (k: string) => STATUTS.find((s) => s.key === k)?.label ?? (k === "pas_interesse" ? "Pas intéressé (ancien)" : k);
/** Avancement dans le pipeline : un import ne fait jamais reculer un statut (perdu = issue finale, rang de « Intéressé »). */
export const STATUT_RANK: Record<string, number> = { a_contacter: 0, contacte: 1, a_repondu: 2, interesse: 3, perdu: 3, pas_interesse: 3, paye: 4 };

/** Motifs de « Perdu ». */
export const MOTIFS = [
  { key: "pas_interesse", label: "Pas intéressé" },
  { key: "pas_de_reponse", label: "Pas de réponse" },
  { key: "injoignable", label: "Pas de WhatsApp / injoignable" },
  { key: "numero_invalide", label: "Numéro invalide" },
  { key: "autre", label: "Autre" },
] as const;
export type Motif = (typeof MOTIFS)[number]["key"];
export const motifLabel = (k: string) => MOTIFS.find((m) => m.key === k)?.label ?? (k || "—");

/** Villes proposées par défaut à l'import (si le lien Maps ne permet pas de la déduire). */
export const VILLES_IMPORT = ["Cancún", "Playa del Carmen", "Puerto Morelos", "Tulum"] as const;
export const OFFRES = ["P1", "P2", "P3"] as const;
export const PER_PAGE = 50;

export const FICHES = [
  { key: "", label: "—" },
  { key: "oui", label: "Oui" },
  { key: "non", label: "Non" },
  { key: "vide", label: "Vide" },
  { key: "verifier", label: "À vérifier" },
] as const;
export const ficheLabel = (k: string) => FICHES.find((f) => f.key === k)?.label ?? "—";

export const INTERETS = [
  { key: "", label: "—" },
  { key: "chaud", label: "Chaud" },
  { key: "tiede", label: "Tiède" },
  { key: "froid", label: "Froid" },
] as const;

export const ACTION_TYPES = [
  { key: "whatsapp", label: "WhatsApp envoyé" },
  { key: "no_whatsapp", label: "Pas de WhatsApp" },
  { key: "repondu", label: "A répondu" },
  { key: "pas_repondu", label: "Pas de réponse" },
  { key: "appel_repondu", label: "Appel — répondu" },
  { key: "appel_pas_repondu", label: "Appel — pas répondu" },
  { key: "interesse", label: "Intéressé" },
  { key: "etape", label: "Prochaine étape" },
  { key: "rappel", label: "À rappeler" },
  { key: "perdu", label: "Perdu" },
  { key: "reactive", label: "Réactivé" },
  { key: "paye", label: "Payé" },
  { key: "reporte", label: "Relance reportée" },
  { key: "visio", label: "Visio" },
  { key: "note", label: "Note" },
] as const;
export const actionLabel = (k: string) => ACTION_TYPES.find((a) => a.key === k)?.label ?? k;
/** Saisie libre dans le journal d'une fiche (les résultats passent par les boutons). */
export const MANUAL_ACTION_TYPES = ["visio", "note"] as const;

/** Objectifs par défaut (Réglages > Objectifs). */
export const DEFAULT_NEW_GOAL = 20;
export const DEFAULT_NEW_HARD = 30;
export const DEFAULT_RELANCES = 20;
/** Au-delà : avertissement sur le risque de blocage du compte WhatsApp. */
export const WA_RISK = 25;
export const MAX_NEW_HARD = 200;
export const TZ = "America/Cancun";

export const FORMULES = ["Base", "Croissance"] as const;
export const CHECKLIST = [
  { key: "photos", label: "Photos" },
  { key: "description", label: "Description" },
  { key: "services", label: "Services" },
  { key: "qr_avis", label: "QR code d'avis" },
] as const;
export const STAT_FIELDS = [
  { key: "vues", label: "Vues" },
  { key: "actions", label: "Actions" },
  { key: "appels", label: "Appels" },
  { key: "itineraires", label: "Itinéraires" },
  { key: "avis", label: "Avis" },
] as const;
