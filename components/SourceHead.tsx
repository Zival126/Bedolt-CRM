import Link from "next/link";
import { PageHead } from "./ui";

/** En-tête d'une source : fil d'Ariane, titre, phrase d'explication, aide repliable. */
export default function SourceHead({ title, lead, help }: { title: string; lead: React.ReactNode; help?: React.ReactNode }) {
  return (
    <>
      <nav className="crumbs" aria-label="Fil d'Ariane"><Link href="/sources">Sources</Link><span aria-hidden="true">›</span><span>{title}</span></nav>
      <PageHead title={title} lead={lead} help={help} />
    </>
  );
}

/** Étape numérotée (1. Où · 2. Quoi · 3. Filtres · 4. Chercher). */
export function Step({ n, title, children, hint }: { n: number; title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="step-t"><span className="step-n">{n}</span>{title}{hint && <span className="small muted" style={{ fontWeight: 400 }}>· {hint}</span>}</p>
      {children}
    </div>
  );
}
