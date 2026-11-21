"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { changeStatus } from "@/app/actions";
import { STATUTS } from "@/lib/constants";

type Card = { id: number; nom: string; ville: string; activite: string; statut: string; score: number | null; interet: string; followup: string | null; offre: string };
type Column = { key: string; total: number; more: string; cards: Card[] };

// Glisser-déposer natif (HTML5). Sur mobile (pas de drag tactile) : le menu déroulant de chaque carte.
// Chaque colonne n'affiche qu'une page (50) ; son total réel est toujours indiqué.
export default function Kanban({ columns }: { columns: Column[] }) {
  const [items, setItems] = useState(columns.flatMap((c) => c.cards));
  const [totals, setTotals] = useState(Object.fromEntries(columns.map((c) => [c.key, c.total])) as Record<string, number>);
  const [over, setOver] = useState<string | null>(null);
  const [, start] = useTransition();
  const move = (id: number, statut: string) => {
    const from = items.find((c) => c.id === id)?.statut;
    if (!from || from === statut) return;
    setItems((all) => all.map((c) => (c.id === id ? { ...c, statut } : c)));
    setTotals((t) => ({ ...t, [from]: t[from] - 1, [statut]: t[statut] + 1 }));
    start(() => changeStatus(id, statut));
  };
  return (
    <div className="kanban">
      {STATUTS.map((s) => {
        const col = items.filter((c) => c.statut === s.key);
        const meta = columns.find((c) => c.key === s.key);
        return (
          <div key={s.key} className={"col" + (over === s.key ? " over" : "")}
            onDragOver={(e) => { e.preventDefault(); setOver(s.key); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = Number(e.dataTransfer.getData("text/plain")); if (id) move(id, s.key); }}>
            <h3><span>{s.label}</span><span title="affichées / total">{col.length < totals[s.key] ? `${col.length} / ${totals[s.key]}` : totals[s.key]}</span></h3>
            {col.map((c) => (
              <div key={c.id} className="card k" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", String(c.id))}>
                <Link href={`/commerces/${c.id}`} className="t" style={{ color: "var(--text)", fontWeight: 600 }}>{c.nom}</Link>
                <div className="small muted">{[c.activite, c.ville].filter(Boolean).join(" · ")}</div>
                <div className="row" style={{ margin: "6px 0" }}>
                  {c.offre && <span className={"badge offre " + c.offre.toLowerCase().replace(/[^a-z0-9]/g, "")}>{c.offre}</span>}
                  {c.interet && <span className="badge accent">{c.interet}</span>}
                  {c.score != null && <span className="badge">{c.score}/100</span>}
                  {c.followup && <span className="badge warn">relance {c.followup.slice(5)}</span>}
                </div>
                <select value={c.statut} onChange={(e) => move(c.id, e.target.value)} style={{ minHeight: 32, fontSize: 13 }}>
                  {STATUTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </div>
            ))}
            {meta && totals[s.key] > col.length && <Link className="small" href={meta.more}>Voir les {totals[s.key]} dans Commerces →</Link>}
          </div>
        );
      })}
    </div>
  );
}
