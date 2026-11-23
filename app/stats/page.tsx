import { weekStats, lostByMotif, pipelineCounts } from "@/lib/crm";
import { addDays, weekStart } from "@/lib/db";
import { motifLabel, STATUTS } from "@/lib/constants";
import { requireSession } from "@/lib/session";

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
  return (
    <>
      <h1>Stats</h1>
      <p className="muted small" style={{ marginTop: 0 }}>Semaine du {fmt(w.start)} au {fmt(w.end)} (lundi → dimanche, heure de Cancún)</p>

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

      <h2>Pipeline actuel</h2>
      <div className="card row">{STATUTS.map((s) => <span key={s.key} className={`st st-${s.key}`}>{s.label} · {pc[s.key] ?? 0}</span>)}</div>
    </>
  );
}
