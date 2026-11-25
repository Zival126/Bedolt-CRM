"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getJson } from "./client-api";
import { NicheBadge } from "./ui";
import { StatusBadge } from "./Badges";
import Icon from "./Icon";
import type { NicheLite } from "@/lib/niche-style";

type R = { id: number; nom: string; ville: string; statut: string; tel: string; specialite: string; niche: NicheLite | null };

// Recherche globale (nom ou téléphone), ouverte depuis la navigation, « / » ou Ctrl+K. Entrée = liste complète.
export default function GlobalSearch({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<R[] | null>(null);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRows(null); return; }
    const n = ++seq.current;
    const h = setTimeout(() => getJson<{ rows: R[] }>("/api/search?q=" + encodeURIComponent(t)).then((r) => { if (n === seq.current) { setRows(r.rows); setSel(0); } }).catch(() => {}), 180);
    return () => clearTimeout(h);
  }, [q]);
  const go = (href: string) => { onClose(); router.push(href); };
  const all = () => go("/commerces?vue=toutes&q=" + encodeURIComponent(q.trim()));
  function key(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min((rows?.length ?? 0), s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (rows && sel < rows.length) go(`/commerces/${rows[sel].id}`); else if (q.trim()) all(); }
  }
  return (
    <div className="modal search-modal" onClick={onClose} role="dialog" aria-modal="true" aria-label="Recherche">
      <div className="card search-box" onClick={(e) => e.stopPropagation()}>
        <div className="search-in"><Icon name="search" size={18} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder="Nom, spécialité ou téléphone" aria-label="Rechercher un commerce" inputMode="search" />
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Fermer"><Icon name="close" size={18} /></button></div>
        {q.trim().length < 2 && <p className="small muted" style={{ margin: "4px 6px" }}>Tape au moins 2 lettres ou 4 chiffres du téléphone.</p>}
        {rows && rows.length === 0 && <p className="small muted" style={{ margin: "4px 6px" }}>Aucun commerce trouvé.</p>}
        {rows && rows.length > 0 && (
          <div className="search-res" role="listbox">
            {rows.map((r, i) => (
              <button key={r.id} type="button" role="option" aria-selected={i === sel} className={i === sel ? "on" : ""} onMouseEnter={() => setSel(i)} onClick={() => go(`/commerces/${r.id}`)}>
                <span className="row spread" style={{ flexWrap: "nowrap" }}><b className="ellipsis">{r.nom}</b><StatusBadge s={r.statut} /></span>
                <span className="row small muted" style={{ gap: 6 }}><NicheBadge n={r.niche} small />{[r.specialite, r.ville, r.tel].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
            <button type="button" className={"search-all" + (sel === rows.length ? " on" : "")} onClick={all}>Voir tous les résultats dans Commerces →</button>
          </div>
        )}
      </div>
    </div>
  );
}
