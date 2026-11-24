import Link from "next/link";
import { ficheLabel } from "@/lib/constants";
import { prettyPhone } from "@/lib/phone";
import type { Business } from "@/lib/crm";
import { StatusBadge } from "./Badges";
import { NicheBadge } from "./ui";
import type { NicheLite } from "@/lib/niche-style";
export { StatusBadge };

export function Counter({ label, n, goal, max }: { label: string; n: number; goal?: number; max?: number }) {
  const cap = max ?? goal ?? 0;
  const full = cap > 0 && n >= cap;
  return (
    <div className="card counter">
      <div className="n" style={full ? { color: max ? "var(--bad)" : "var(--ok)" } : undefined}>{n}{cap ? <span className="muted small"> / {cap}</span> : null}</div>
      <div className="l">{label}</div>
      {cap > 0 && <div className={"bar" + (full ? " full" : "")}><i style={{ width: Math.min(100, (n / cap) * 100) + "%" }} /></div>}
    </div>
  );
}

export function BusinessItem({ b, extra, niche }: { b: Business; extra?: React.ReactNode; niche?: NicheLite | null }) {
  return (
    <Link href={`/commerces/${b.id}`} className="item">
      <div className="row spread">
        <span className="t">{b.nom}</span>
        <span className="row">{b.score != null && <span className="badge accent">{b.score}</span>}<StatusBadge s={b.statut} motif={b.perdu_motif} /></span>
      </div>
      <div className="s row" style={{ gap: 6 }}>{niche !== undefined && <NicheBadge n={niche} small />}{[niche !== undefined ? "" : b.niche || b.activite, b.zone, b.ville, b.tel_norm ? prettyPhone(b.telephone || b.tel_norm) : "pas de tél."].filter(Boolean).join(" · ")}</div>
      <div className="row" style={{ marginTop: 4 }}>
        {b.offre && <span className={"badge offre " + b.offre.toLowerCase().replace(/[^a-z0-9]/g, "")}>{b.offre}</span>}
        {(b.note_google != null || b.nb_avis != null) && <span className="stars">★ {b.note_google != null ? b.note_google.toFixed(1) : "—"}<span className="muted"> ({b.nb_avis ?? 0})</span></span>}
        {b.fiche_google && <span className="badge">Fiche : {ficheLabel(b.fiche_google)}</span>}
        {b.interet && <span className="badge accent">{b.interet}</span>}
        {extra}
      </div>
    </Link>
  );
}
