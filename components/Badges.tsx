import { statutLabel, motifLabel } from "@/lib/constants";

export const OffreBadge = ({ o }: { o: string }) =>
  o ? <span className={"badge offre " + o.toLowerCase().replace(/[^a-z0-9]/g, "")}>{o}</span> : null;
export const Stars = ({ note, avis }: { note: number | null; avis: number | null }) =>
  note == null && avis == null ? null : <span className="stars">{note != null ? `★ ${note.toFixed(1)}` : "★ —"}<span className="muted"> ({avis ?? 0})</span></span>;
/** Couleurs de statut identiques partout : À contacter gris, Contacté bleu, A répondu violet, Intéressé orange, Payé vert, Perdu rouge atténué. */
export const StatusBadge = ({ s, motif }: { s: string; motif?: string }) =>
  <span className={`st st-${s === "pas_interesse" ? "perdu" : s}`}>{statutLabel(s)}{s === "perdu" && motif ? ` · ${motifLabel(motif)}` : ""}</span>;
