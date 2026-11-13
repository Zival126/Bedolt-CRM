"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { changeStatus } from "@/app/actions";
import { STATUTS } from "@/lib/constants";

type Card = { id: number; nom: string; ville: string; activite: string; statut: string; score: number | null; interet: string; followup: string | null };

// Glisser-déposer natif (HTML5). Sur mobile (pas de drag tactile) : le menu déroulant de chaque carte.
export default function Kanban({ cards }: { cards: Card[] }) {
  const [items, setItems] = useState(cards);
  const [over, setOver] = useState<string | null>(null);
  const [, start] = useTransition();
  const move = (id: number, statut: string) => {
    setItems((all) => all.map((c) => (c.id === id ? { ...c, statut } : c)));
    start(() => changeStatus(id, statut));
  };
  return (
    <div className="kanban">
      {STATUTS.map((s) => {
        const col = items.filter((c) => c.statut === s.key);
        return (
          <div key={s.key} className={"col" + (over === s.key ? " over" : "")}
            onDragOver={(e) => { e.preventDefault(); setOver(s.key); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = Number(e.dataTransfer.getData("text/plain")); if (id) move(id, s.key); }}>
            <h3><span>{s.label}</span><span>{col.length}</span></h3>
            {col.map((c) => (
              <div key={c.id} className="card k" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", String(c.id))}>
                <Link href={`/commerces/${c.id}`} className="t" style={{ color: "var(--text)", fontWeight: 600 }}>{c.nom}</Link>
                <div className="small muted">{[c.activite, c.ville].filter(Boolean).join(" · ")}</div>
                <div className="row" style={{ margin: "6px 0" }}>
                  {c.interet && <span className="badge accent">{c.interet}</span>}
                  {c.score != null && <span className="badge">{c.score}/100</span>}
                  {c.followup && <span className="badge warn">relance {c.followup.slice(5)}</span>}
                </div>
                <select value={c.statut} onChange={(e) => move(c.id, e.target.value)} style={{ minHeight: 32, fontSize: 13 }}>
                  {STATUTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
