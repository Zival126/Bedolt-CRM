import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getBusiness } from "@/lib/crm";
import { saveClient, saveStats } from "@/app/actions";
import { CHECKLIST, FORMULES, STAT_FIELDS } from "@/lib/constants";
import { requireSession } from "@/lib/session";
import ActionForm from "@/components/ActionForm";

export const dynamic = "force-dynamic";
type Client = { formule: string; prix_install: number; prix_mensuel: number; acompte_montant: number; acompte_paye: number; acompte_date: string | null; checklist: string; parrain_id: number | null };
type Stat = Record<string, number | string | null>;

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession("redirect");
  const id = Number((await params).id);
  const b = getBusiness(id);
  const c = db.prepare("SELECT * FROM clients WHERE business_id=?").get(id) as Client | undefined;
  if (!b || !c) notFound();
  const chk = JSON.parse(c.checklist || "{}") as Record<string, boolean>;
  const stats = db.prepare("SELECT * FROM client_stats WHERE business_id=? ORDER BY month DESC").all(id) as Stat[];
  const base = stats.find((s) => s.month === "base");
  const months = stats.filter((s) => s.month !== "base");
  const clients = db.prepare("SELECT b.id, b.nom FROM clients c JOIN businesses b ON b.id=c.business_id WHERE b.id != ? ORDER BY b.nom").all(id) as { id: number; nom: string }[];
  const filleuls = db.prepare("SELECT b.id, b.nom FROM clients c JOIN businesses b ON b.id=c.business_id WHERE c.parrain_id=?").all(id) as { id: number; nom: string }[];
  const unpaid = !c.acompte_paye;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const StatInputs = ({ s }: { s?: Stat }) => <>{STAT_FIELDS.map((f) => <label key={f.key} className="f">{f.label}<input name={f.key} type="number" min={0} defaultValue={(s?.[f.key] as number) ?? ""} /></label>)}</>;
  return (
    <>
      <div className="row spread"><h1 style={{ margin: 0 }}>{b.nom}</h1><Link href={`/commerces/${id}`} className="btn sm">Fiche commerce</Link></div>
      {unpaid
        ? <div className="banner bad" style={{ margin: "12px 0" }}>ACOMPTE 50 % NON PAYÉ — ne pas démarrer le travail ({c.acompte_montant || c.prix_install / 2})</div>
        : <div className="banner ok" style={{ margin: "12px 0" }}>Acompte payé{c.acompte_date ? ` le ${c.acompte_date}` : ""} — travail autorisé</div>}

      <ActionForm action={saveClient} className="card stack">
        <input type="hidden" name="id" value={id} />
        <div className="grid gform">
          <label className="f">Formule<select name="formule" defaultValue={c.formule}>{FORMULES.map((f) => <option key={f}>{f}</option>)}</select></label>
          <label className="f">Prix d'installation<input name="prix_install" type="number" step="any" defaultValue={c.prix_install} /></label>
          <label className="f">Prix mensuel<input name="prix_mensuel" type="number" step="any" defaultValue={c.prix_mensuel} /></label>
          <label className="f">Acompte 50 % (montant)<input name="acompte_montant" type="number" step="any" defaultValue={c.acompte_montant || ""} placeholder={String(c.prix_install / 2)} /></label>
          <label className="f">Date de l'acompte<input name="acompte_date" type="date" defaultValue={c.acompte_date ?? ""} /></label>
          <label className="f">Recommandé par<select name="parrain_id" defaultValue={c.parrain_id ?? ""}><option value="">—</option>{clients.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}</select></label>
        </div>
        <label className="chk"><input type="checkbox" name="acompte_paye" defaultChecked={!!c.acompte_paye} /> Acompte payé</label>
        <div>
          <b className="small">Checklist de mise en place</b>{unpaid && <span className="small muted"> (à faire après l'acompte)</span>}
          <div className="stack" style={{ marginTop: 6 }}>
            {CHECKLIST.map((i) => <label key={i.key} className="chk"><input type="checkbox" name={`chk_${i.key}`} defaultChecked={!!chk[i.key]} /> {i.label}</label>)}
          </div>
        </div>
        <div><button className="btn primary">Enregistrer</button></div>
      </ActionForm>
      {filleuls.length > 0 && <p className="small">Parrainages : {filleuls.map((f) => <Link key={f.id} href={`/clients/${f.id}`}>{f.nom}</Link>).reduce<React.ReactNode[]>((a, x) => (a.length ? [...a, ", ", x] : [x]), [])}</p>}

      <h2>Fiche Google — chiffres</h2>
      <ActionForm action={saveStats} className="card stack">
        <input type="hidden" name="id" value={id} /><input type="hidden" name="month" value="base" />
        <b className="small">Chiffres de départ</b>
        <div className="grid g3"><StatInputs s={base} /></div>
        <div><button className="btn">Enregistrer le départ</button></div>
      </ActionForm>
      <ActionForm action={saveStats} className="card stack" style={{ marginTop: 10 }}>
        <input type="hidden" name="id" value={id} />
        <div className="row"><b className="small">Saisie mensuelle</b><input name="month" type="month" defaultValue={thisMonth} style={{ width: 170 }} /></div>
        <div className="grid g3"><StatInputs /></div>
        <div><button className="btn">Enregistrer le mois</button></div>
      </ActionForm>
      {months.length > 0 && <div className="card" style={{ marginTop: 10, overflowX: "auto" }}><table>
        <thead><tr><th>Mois</th>{STAT_FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
        <tbody>{months.map((m) => <tr key={String(m.month)}><td>{m.month}</td>{STAT_FIELDS.map((f) => <td key={f.key}>{m[f.key] ?? "—"}</td>)}</tr>)}</tbody></table></div>}
      <p style={{ marginTop: 14 }}><Link className="btn primary" href={`/clients/${id}/rapport`}>Rapport mensuel →</Link></p>
    </>
  );
}
