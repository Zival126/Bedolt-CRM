import Link from "next/link";
import { statutLabel, ficheLabel } from "@/lib/constants";
import { prettyPhone } from "@/lib/phone";
import type { Business } from "@/lib/crm";

export const StatusBadge = ({ s }: { s: string }) => (
  <span className={"badge " + (s === "paye" ? "ok" : s === "interesse" ? "accent" : s === "pas_interesse" ? "bad" : "")}>{statutLabel(s)}</span>
);

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

export function BusinessItem({ b, extra }: { b: Business; extra?: React.ReactNode }) {
  return (
    <Link href={`/commerces/${b.id}`} className="item">
      <div className="row spread">
        <span className="t">{b.nom}</span>
        <span className="row">{b.score != null && <span className="badge accent">{b.score}</span>}<StatusBadge s={b.statut} /></span>
      </div>
      <div className="s">{[b.activite, b.ville, b.tel_norm ? prettyPhone(b.telephone) : "pas de tél."].filter(Boolean).join(" · ")}</div>
      <div className="row" style={{ marginTop: 4 }}>
        {b.fiche_google && <span className="badge">Fiche : {ficheLabel(b.fiche_google)}</span>}
        {b.interet && <span className="badge accent">{b.interet}</span>}
        {extra}
      </div>
    </Link>
  );
}
