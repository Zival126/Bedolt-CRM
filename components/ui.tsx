// Composants d'interface communs (sans état : utilisables côté serveur et navigateur).
import { iconPath, NO_NICHE, type NicheLite } from "@/lib/niche-style";

/** En-tête de page : titre + phrase « qu'est-ce que je fais ici ? » + actions + aide repliable. */
export function PageHead({ title, lead, actions, help }: { title: React.ReactNode; lead?: React.ReactNode; actions?: React.ReactNode; help?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-row">
        <div className="page-head-t"><h1>{title}</h1>{lead && <p className="lead">{lead}</p>}</div>
        {actions && <div className="page-head-a">{actions}</div>}
      </div>
      {help && <Help>{help}</Help>}
    </header>
  );
}

/** Aide repliable (ⓘ) : explications techniques hors du flux principal. */
export function Help({ children, label = "Comment ça marche ?" }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="help">
      <summary><span className="help-i" aria-hidden="true">i</span>{label}</summary>
      <div className="help-body">{children}</div>
    </details>
  );
}

export function NicheIcon({ icon, size = 14 }: { icon: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPath(icon)} /></svg>;
}

/** Badge de niche : puce pleine de la couleur de la niche, avec son icône. Sans niche : gris. */
export function NicheBadge({ n, small, count }: { n?: NicheLite | null; small?: boolean; count?: number }) {
  const x = n ?? NO_NICHE;
  return (
    <span className={"nb" + (small ? " sm" : "") + (n ? "" : " none")} style={{ "--n": x.color } as React.CSSProperties} title={x.label}>
      <NicheIcon icon={x.icon} size={small ? 12 : 13} /><span className="nb-l">{x.label}</span>{count != null && <span className="nb-c">{count.toLocaleString("fr-FR")}</span>}
    </span>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty"><b>{title}</b>{children && <div className="small">{children}</div>}{action && <div className="row" style={{ justifyContent: "center" }}>{action}</div>}</div>;
}

/** Section titrée avec phrase d'explication (Réglages, Sources). */
export function Section({ id, title, lead, help, children, aside }: { id?: string; title: string; lead?: React.ReactNode; help?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="sect" id={id} aria-labelledby={id ? id + "-t" : undefined}>
      <div className="sect-head"><div><h2 id={id ? id + "-t" : undefined}>{title}</h2>{lead && <p className="lead small">{lead}</p>}</div>{aside}</div>
      {help && <Help>{help}</Help>}
      {children}
    </section>
  );
}

export const fmtN = (n: number) => n.toLocaleString("fr-FR");
