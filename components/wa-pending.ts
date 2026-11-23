// WhatsApp ouvert mais pas encore confirmé : gardé en sessionStorage pour redemander « Envoyé ? » si la page a été
// rechargée entre-temps (téléphone : retour depuis l'application WhatsApp).
export type PendingWa = { id: number; nom: string; template: "first" | "j2" | "j7" | null; at: number };
const KEY = "bedolt-wa-pending";
export function setPending(p: PendingWa) { try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch { /* navigation privée */ } }
export function clearPending() { try { sessionStorage.removeItem(KEY); } catch { /* */ } }
export function readPending(): PendingWa | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as PendingWa | null;
    if (!p || Date.now() - p.at > 30 * 60_000) { clearPending(); return null; }
    return p;
  } catch { return null; }
}
/** Téléphone : wa.me dans le même onglet (lien universel → application) ; ordinateur : nouvel onglet (WhatsApp Web). */
export const isTouch = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
