"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { statutLabel, ficheLabel } from "@/lib/constants";

type Row = { id: number; nom: string; activite: string; ville: string; statut: string; fiche_google: string; score: number | null; score_raison: string; tel: string };

// Liste avec cases à cocher + bouton « Classer avec l'IA » sur la sélection.
export default function RankList({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function rank() {
    setBusy(true); setMsg("Classement en cours…");
    const r = await fetch("/api/ai/rank", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...sel] }) });
    const j = await r.json();
    setMsg(r.ok ? `${j.done}/${j.total} commerces classés.` : `⚠️ ${j.error} (${j.done ?? 0} classés)`);
    setBusy(false); router.refresh();
  }
  return (
    <>
      <div className="row spread" style={{ margin: "10px 0" }}>
        <span className="muted small">{rows.length} commerce(s) · {sel.size} sélectionné(s)</span>
        <span className="row">
          <button className="btn sm" onClick={() => setSel(sel.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))}>Tout sélectionner</button>
          <button className="btn sm primary" disabled={!sel.size || busy} onClick={rank}>Classer avec l'IA</button>
        </span>
      </div>
      {msg && <p className="small">{msg}</p>}
      <div className="list">
        {rows.map((r) => (
          <div key={r.id} className="item row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} style={{ marginTop: 3 }} />
            <Link href={`/commerces/${r.id}`} style={{ flex: 1, color: "inherit", minWidth: 0 }}>
              <div className="row spread"><span className="t">{r.nom}</span>{r.score != null && <span className="badge accent">{r.score}/100</span>}</div>
              <div className="s">{[r.activite, r.ville, r.tel || "pas de tél."].filter(Boolean).join(" · ")}</div>
              <div className="row" style={{ marginTop: 4 }}>
                <span className="badge">{statutLabel(r.statut)}</span>
                <span className="badge">Fiche : {ficheLabel(r.fiche_google)}</span>
              </div>
              {r.score_raison && <div className="small muted" style={{ marginTop: 4 }}>{r.score_raison}</div>}
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}
