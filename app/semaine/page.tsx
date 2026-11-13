import { weekStats, dayCounts } from "@/lib/crm";
import { addDays, weekStart } from "@/lib/db";
import { Counter } from "@/components/Bits";

export const dynamic = "force-dynamic";

export default function Semaine() {
  const start = weekStart();
  const weeks = [0, 1, 2, 3].map((i) => weekStats(addDays(start, -7 * i)));
  const w = weeks[0];
  void dayCounts;
  return (
    <>
      <h1>Vue hebdo</h1>
      <p className="muted small">Semaine du {w.start} au {w.end}</p>
      <div className="grid g2 g4">
        <Counter label="Contactés" n={w.contacte} /><Counter label="Ont répondu" n={w.a_repondu} />
        <Counter label="Intéressés" n={w.interesse} /><Counter label="Payés" n={w.paye} />
      </div>
      <h2>4 dernières semaines</h2>
      <div className="card"><table>
        <thead><tr><th>Semaine du</th><th>Contactés</th><th>Répondus</th><th>Intéressés</th><th>Payés</th></tr></thead>
        <tbody>{weeks.map((x) => <tr key={x.start}><td>{x.start}</td><td>{x.contacte}</td><td>{x.a_repondu}</td><td>{x.interesse}</td><td>{x.paye}</td></tr>)}</tbody>
      </table></div>
      <p className="muted small">Chaque chiffre compte les commerces ayant atteint ce statut pendant la semaine (d'après l'historique des statuts).</p>
    </>
  );
}
