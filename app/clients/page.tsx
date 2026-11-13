import Link from "next/link";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = { id: number; nom: string; ville: string; formule: string; prix_install: number; prix_mensuel: number; acompte_paye: number; acompte_montant: number };

export default function Clients() {
  const rows = db.prepare(`SELECT b.id, b.nom, b.ville, c.formule, c.prix_install, c.prix_mensuel, c.acompte_paye, c.acompte_montant
    FROM clients c JOIN businesses b ON b.id = c.business_id ORDER BY b.nom`).all() as Row[];
  const mrr = rows.reduce((a, r) => a + r.prix_mensuel, 0);
  return (
    <>
      <h1>Clients</h1>
      <p className="muted small">{rows.length} client(s) · {mrr.toLocaleString("fr-FR")} /mois récurrent. Un commerce devient client quand son statut passe à « Payé ».</p>
      <div className="list">
        {rows.map((r) => (
          <Link key={r.id} href={`/clients/${r.id}`} className="item">
            <div className="row spread"><span className="t">{r.nom}</span><span className="badge">{r.formule}</span></div>
            <div className="s">{r.ville} · installation {r.prix_install} · {r.prix_mensuel}/mois</div>
            <div style={{ marginTop: 4 }}>{r.acompte_paye ? <span className="badge ok">Acompte payé</span> : <span className="badge bad">Acompte NON payé — ne pas démarrer</span>}</div>
          </Link>
        ))}
        {rows.length === 0 && <p className="muted">Aucun client pour l'instant.</p>}
      </div>
    </>
  );
}
