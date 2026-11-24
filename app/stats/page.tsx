import { weekStats, lostByMotif, pipelineCounts } from "@/lib/crm";
import { addDays, weekStart } from "@/lib/db";
import { motifLabel, STATUTS } from "@/lib/constants";
import { requireSession } from "@/lib/session";
import { sourceStats } from "@/lib/source-stats";
import { nicheList, nicheStats } from "@/lib/niches";
import { PageHead, NicheBadge } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";
const pct = (x: number | null) => (x == null ? "—" : Math.round(x * 100) + " %");
const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC", day: "numeric", month: "short" });

// Stats : entonnoir de la semaine (contactés → répondu → intéressé → payé), taux de réponse, perdus par motif.
export default async function Stats() {
  await requireSession("redirect");
  const start = weekStart();
  const weeks = [0, 1, 2, 3].map((i) => weekStats(addDays(start, -7 * i)));
  const w = weeks[0];
  const steps = [
    { k: "contacte", l: "Contactés", n: w.contacte }, { k: "a_repondu", l: "Ont répondu", n: w.a_repondu },
    { k: "interesse", l: "Intéressés", n: w.interesse }, { k: "paye", l: "Payés", n: w.paye },
  ];
  const max = Math.max(1, ...steps.map((s) => s.n));
  const lost = lostByMotif();
  const lostMax = Math.max(1, ...lost.map((l) => l.n), ...w.perdus.map((l) => l.n));
  const pc = pipelineCounts();
  const src = sourceStats();
  const ns = nicheStats();
  const p = (n: number, d: number) => (d ? Math.round((n / d) * 100) + " %" : "—");
  return (
    <>
      <PageHead title="Stats" lead={<>Ce que donne ta prospection : semaine du {fmt(w.start)} au {fmt(w.end)} (lundi → dimanche, heure de Cancún), par niche et par source.</>} />

      <div className="kpi">
        <div className="card"><div className="n">{w.contacte}</div><div className="l">contactés cette semaine</div></div>
        <div className="card"><div className="n">{pct(w.taux)}</div><div className="l">taux de réponse ({w.a_repondu}/{w.contacte})</div></div>
        <div className="card"><div className="n">{w.interesse}</div><div className="l">intéressés</div></div>
        <div className="card"><div className="n">{w.paye}</div><div className="l">payés</div></div>
      </div>

      <h2>Entonnoir de la semaine</h2>
      <div className="card funnel">
        {steps.map((s, i) => (
          <div key={s.k} className="fstep">
            <span className="small">{s.l}</span>
            <div className="fbar"><i style={{ width: Math.max(s.n ? 3 : 0, (s.n / max) * 100) + "%", background: `var(--s-${s.k})` }} /></div>
            <b>{s.n}{i > 0 && steps[i - 1].n ? <span className="tiny muted"> {Math.round((s.n / steps[i - 1].n) * 100)}%</span> : null}</b>
          </div>
        ))}
        <p className="tiny muted" style={{ margin: 0 }}>Commerces ayant atteint chaque étape pendant la semaine (historique des statuts et réponses journalisées). Le % compare à l'étape précédente.</p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginTop: 0 }}>
        <div>
          <h2>Perdus cette semaine · {w.perdusTotal}</h2>
          <div className="card funnel">
            {w.perdus.length === 0 && <span className="small muted">Aucun prospect perdu cette semaine.</span>}
            {w.perdus.map((p) => <div key={p.motif} className="fstep"><span className="small">{motifLabel(p.motif)}</span><div className="fbar"><i style={{ width: (p.n / lostMax) * 100 + "%", background: "var(--s-perdu)" }} /></div><b>{p.n}</b></div>)}
          </div>
        </div>
        <div>
          <h2>Perdus (total) · {lost.reduce((a, l) => a + l.n, 0)}</h2>
          <div className="card funnel">
            {lost.length === 0 && <span className="small muted">Aucune fiche perdue.</span>}
            {lost.map((p) => <div key={p.motif} className="fstep"><span className="small">{motifLabel(p.motif)}</span><div className="fbar"><i style={{ width: (p.n / lostMax) * 100 + "%", background: "var(--s-perdu)" }} /></div><b>{p.n}</b></div>)}
          </div>
        </div>
      </div>

      <h2>4 dernières semaines</h2>
      <div className="card" style={{ overflowX: "auto" }}><table>
        <thead><tr><th>Semaine du</th><th>Contactés</th><th>Répondu</th><th>Taux</th><th>Intéressés</th><th>Payés</th><th>Perdus</th></tr></thead>
        <tbody>{weeks.map((x) => <tr key={x.start}><td>{fmt(x.start)}</td><td>{x.contacte}</td><td>{x.a_repondu}</td><td>{pct(x.taux)}</td><td>{x.interesse}</td><td>{x.paye}</td><td>{x.perdusTotal}</td></tr>)}</tbody>
      </table></div>

      <h2>Par niche</h2>
      <div className="card" style={{ overflowX: "auto" }}><table className="srcstats">
        <thead><tr><th>Niche</th><th>Fiches</th><th>À contacter</th><th>Contactées</th><th>Réponses</th><th>Taux de réponse</th><th>Clients</th></tr></thead>
        <tbody>{[...nicheList(true).map((n) => [n, ns.get(n.id)] as const), [null, ns.get(0)] as const].filter(([, x]) => x && x.fiches > 0).map(([n, x]) => (
          <tr key={n?.id ?? 0}><td><Link href={`/commerces?vue=toutes&n=${n?.id ?? 0}`}><NicheBadge n={n} small /></Link></td><td>{x!.fiches.toLocaleString("fr-FR")}</td><td>{x!.aContacter.toLocaleString("fr-FR")}</td>
            <td>{x!.contactees.toLocaleString("fr-FR")}</td><td>{x!.reponses}</td><td>{p(x!.reponses, x!.contactees)}</td><td>{x!.clients}</td></tr>))}</tbody>
      </table></div>

      <h2>Par source</h2>
      <div className="card" style={{ overflowX: "auto" }}><table className="srcstats">
        <thead><tr><th>Source</th><th>Fiches</th><th>📞 tél.</th><th>✉️ email</th><th>🌐 site</th><th>WhatsApp oui</th><th>Réseau</th><th>Contactées</th><th>Taux de réponse</th><th>Taux d'intérêt</th><th>Clients</th></tr></thead>
        <tbody>{src.map((x) => (
          <tr key={x.key}><td><b>{x.label}</b>{x.dnc ? <div className="tiny muted">{x.dnc} ne pas contacter</div> : null}</td><td>{x.total.toLocaleString("fr-FR")}</td>
            <td>{p(x.tel, x.total)}</td><td>{p(x.email, x.total)}</td><td>{p(x.site, x.total)}</td><td>{p(x.wa, x.total)}</td><td>{p(x.social, x.total)}</td>
            <td>{x.contactes.toLocaleString("fr-FR")}</td><td>{p(x.repondu, x.contactes)}</td><td>{p(x.interesse, x.contactes)}</td><td>{x.clients}</td></tr>
        ))}</tbody>
      </table>
      <p className="tiny muted" style={{ margin: "8px 0 0" }}>Une fiche trouvée par plusieurs sources compte dans chacune. Taux de réponse et d'intérêt : sur les fiches contactées de la source.</p></div>

      <h2>Pipeline actuel</h2>
      <div className="card row">{STATUTS.map((s) => <span key={s.key} className={`st st-${s.key}`}>{s.label} · {pc[s.key] ?? 0}</span>)}</div>
    </>
  );
}
