"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeStatus } from "@/app/actions";
import { STATUTS, MOTIFS, motifLabel } from "@/lib/constants";
import { OffreBadge } from "./Badges";
import { toast } from "./Toast";

type Card = { id: number; nom: string; ville: string; activite: string; statut: string; score: number | null; interet: string; followup: string | null; nextDate: string | null; nextStep: string; offre: string; motif: string };
type Column = { key: string; total: number; more: string; cards: Card[] };

// Glisser-déposer natif (HTML5) ; sur téléphone : le menu de chaque carte. Vers « Perdu » : choix du motif.
// Chaque colonne n'affiche qu'une page (50) ; son total réel est toujours indiqué. Colonne Perdu repliée par défaut.
export default function Kanban({ columns }: { columns: Column[] }) {
  const router = useRouter();
  const [items, setItems] = useState(columns.flatMap((c) => c.cards));
  const [totals, setTotals] = useState(Object.fromEntries(columns.map((c) => [c.key, c.total])) as Record<string, number>);
  const [over, setOver] = useState<string | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [ask, setAsk] = useState<number | null>(null); // carte en attente du motif de perte
  const [, start] = useTransition();
  const move = (id: number, statut: string, motif = "") => {
    const from = items.find((c) => c.id === id)?.statut;
    if (!from || from === statut) return;
    if (statut === "perdu" && !motif) { setAsk(id); return; }
    setAsk(null);
    setItems((all) => all.map((c) => (c.id === id ? { ...c, statut, motif } : c)));
    setTotals((t) => ({ ...t, [from]: t[from] - 1, [statut]: t[statut] + 1 }));
    start(async () => {
      const r = await changeStatus(id, statut, motif);
      if (r?.error) { toast(r.error, { kind: "err" }); router.refresh(); }
    });
  };
  const askCard = items.find((c) => c.id === ask);
  return (
    <>
      <div className="kanban">
        {STATUTS.map((s) => {
          const col = items.filter((c) => c.statut === s.key);
          const meta = columns.find((c) => c.key === s.key);
          const drop = {
            onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(s.key); }, onDragLeave: () => setOver(null),
            onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(null); const id = Number(e.dataTransfer.getData("text/plain")); if (id) move(id, s.key); },
          };
          if (s.key === "perdu" && !lostOpen) return (
            <button key={s.key} type="button" className={`col col-perdu collapsed${over === s.key ? " over" : ""}`} onClick={() => setLostOpen(true)} {...drop} title="Afficher la colonne Perdu">
              <span className="st st-perdu">{totals.perdu ?? 0}</span><span className="vlabel">Perdu ▸</span>
            </button>
          );
          return (
            <div key={s.key} className={`col col-${s.key}${over === s.key ? " over" : ""}`} {...drop}>
              <h3><span className={`st st-${s.key}`}>{s.label}</span>
                <span className="row" style={{ gap: 4 }}><span className="muted" title="affichées / total">{col.length < totals[s.key] ? `${col.length} / ${totals[s.key]}` : totals[s.key]}</span>
                  {s.key === "perdu" && <button className="btn sm ghost icon" onClick={() => setLostOpen(false)} aria-label="Replier">◂</button>}</span></h3>
              {col.length === 0 && <div className="small muted" style={{ padding: "6px 6px 10px" }}>Aucune fiche.</div>}
              {col.map((c) => (
                <div key={c.id} className="card k" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", String(c.id))}>
                  <Link href={`/commerces/${c.id}`} style={{ color: "var(--text)", fontWeight: 600 }}>{c.nom}</Link>
                  <div className="small muted">{[c.activite, c.ville].filter(Boolean).join(" · ")}</div>
                  <div className="row" style={{ gap: 6 }}>
                    <OffreBadge o={c.offre} />
                    {c.score != null && <span className="badge">{c.score}/100</span>}
                    {c.followup && <span className="badge">relance {c.followup.slice(5)}</span>}
                    {c.nextDate && c.statut !== "perdu" && <span className="badge accent">{c.nextStep ? c.nextStep.slice(0, 24) + " · " : "rappel "}{c.nextDate.slice(5)}</span>}
                    {c.statut === "perdu" && <span className="small muted">{motifLabel(c.motif)}</span>}
                  </div>
                  <select value={c.statut} onChange={(e) => move(c.id, e.target.value)} style={{ minHeight: 36, fontSize: 13 }} aria-label={`Statut de ${c.nom}`}>
                    {STATUTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                </div>
              ))}
              {meta && totals[s.key] > col.length && <Link className="small" href={meta.more}>Voir les {totals[s.key]} dans Commerces →</Link>}
            </div>
          );
        })}
      </div>
      {askCard && (
        <div className="modal" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setAsk(null); }}>
          <div className="card stack">
            <b>{askCard.nom} → Perdu : motif ?</b>
            <div className="grid g2">
              {MOTIFS.map((m) => <button key={m.key} className="btn lost" onClick={() => move(askCard.id, "perdu", m.key)}>{m.label}</button>)}
              <button className="btn" onClick={() => setAsk(null)}>Annuler</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
