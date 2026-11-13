import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getBusiness } from "@/lib/crm";
import { STAT_FIELDS } from "@/lib/constants";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";
type Stat = Record<string, number | null | string>;

// Une page A4 : avant (chiffres de départ) / maintenant (dernier mois saisi). « Imprimer / PDF » → enregistrer en PDF.
export default async function Rapport({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mois?: string }> }) {
  const id = Number((await params).id);
  const b = getBusiness(id);
  if (!b) notFound();
  const stats = db.prepare("SELECT * FROM client_stats WHERE business_id=? ORDER BY month DESC").all(id) as Stat[];
  const base = stats.find((s) => s.month === "base");
  const months = stats.filter((s) => s.month !== "base");
  const mois = (await searchParams).mois;
  const now = months.find((m) => m.month === mois) ?? months[0];
  const delta = (k: string) => {
    const a = base?.[k] as number | null | undefined, n = now?.[k] as number | null | undefined;
    if (a == null || n == null) return "—";
    const d = n - a;
    return (d > 0 ? "+" : "") + d;
  };
  return (
    <>
      <div className="row noprint" style={{ marginBottom: 12 }}>
        <PrintButton />
        {months.map((m) => <a key={String(m.month)} className="btn sm" href={`?mois=${m.month}`}>{String(m.month)}</a>)}
      </div>
      <div className="report">
        <h1 style={{ marginBottom: 2 }}>Rapport mensuel — {b.nom}</h1>
        <p className="muted">{now ? `Période : ${now.month}` : "Aucun mois saisi"} · {b.ville}</p>
        <table style={{ marginTop: 16 }}>
          <thead><tr><th>Indicateur Google</th><th>Avant</th><th>Maintenant</th><th>Évolution</th></tr></thead>
          <tbody>{STAT_FIELDS.map((f) => (
            <tr key={f.key}><td>{f.label}</td><td>{base?.[f.key] ?? "—"}</td><td>{now?.[f.key] ?? "—"}</td><td><b>{delta(f.key)}</b></td></tr>
          ))}</tbody>
        </table>
        <p className="muted" style={{ marginTop: 24, fontSize: 12 }}>Bedolt — fiches Google et sites web pour commerces locaux.</p>
      </div>
    </>
  );
}
