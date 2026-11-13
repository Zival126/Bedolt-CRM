export const STATUTS = [
  { key: "a_contacter", label: "À contacter" },
  { key: "contacte", label: "Contacté" },
  { key: "a_repondu", label: "A répondu" },
  { key: "interesse", label: "Intéressé" },
  { key: "paye", label: "Payé" },
  { key: "pas_interesse", label: "Pas intéressé" },
] as const;
export type Statut = (typeof STATUTS)[number]["key"];
export const statutLabel = (k: string) => STATUTS.find((s) => s.key === k)?.label ?? k;

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
  { key: "appel_repondu", label: "Appel — répondu" },
  { key: "appel_pas_repondu", label: "Appel — pas répondu" },
  { key: "whatsapp", label: "WhatsApp envoyé" },
  { key: "visio", label: "Visio" },
  { key: "note", label: "Note" },
] as const;
export const actionLabel = (k: string) => ACTION_TYPES.find((a) => a.key === k)?.label ?? k;

export const DAILY_CALLS = 5;
export const DAILY_WHATSAPP = 20;
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
