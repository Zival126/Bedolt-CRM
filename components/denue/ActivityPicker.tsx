"use client";
import { useEffect, useRef, useState } from "react";
import { getJson } from "../client-api";
import type { Code, NicheP } from "./types";

type Hit = { code: string; title: string; level: number; match: string; parent: string };
const LEVEL = { 2: "secteur", 3: "sous-secteur", 4: "branche", 5: "sous-branche", 6: "classe" } as Record<number, string>;

// Activités SCIAN 2023 (catalogue officiel INEGI) : recherche par mot-clé ES / FR ou par code, multi-sélection,
// raccourcis « Mes niches ».
export default function ActivityPicker({ value, onChange, niches, required }: {
  value: Code[]; onChange: (c: Code[]) => void; niches: NicheP[]; required?: boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits([]); return; }
    const n = ++seq.current;
    setBusy(true);
    const h = setTimeout(() => {
      getJson<{ hits: Hit[] }>("/api/denue/scian?q=" + encodeURIComponent(t))
        .then((r) => { if (n === seq.current) { setHits(r.hits); setOpen(true); } })
        .catch(() => {}).finally(() => { if (n === seq.current) setBusy(false); });
    }, 220);
    return () => clearTimeout(h);
  }, [q]);

  const has = (c: string) => value.some((v) => v.code === c);
  const add = (list: Code[]) => onChange([...value, ...list.filter((x) => !has(x.code))].slice(0, 30));
  const remove = (c: string) => onChange(value.filter((v) => v.code !== c));

  return (
    <div className="stack actpick" style={{ gap: 8 }}>
      <div className="row spread"><b className="small">Activités {required ? "*" : <span className="muted">(facultatif : filtre les résultats)</span>}</b>
        {value.length > 0 && <button type="button" className="link small" onClick={() => onChange([])}>Tout retirer</button>}</div>
      {niches.length > 0 && (
        <div className="chips scroll" aria-label="Mes niches">
          <span className="chip-label">Mes niches</span>
          {niches.map((n) => {
            const on = n.codes.every(has);
            return <button key={n.label} type="button" className={on ? "on" : ""} title={n.codes.join(", ")}
              onClick={() => (on ? onChange(value.filter((v) => !n.codes.includes(v.code))) : add(n.codes.map((c, i) => ({ code: c, title: n.titles[i] ?? "" }))))}>{n.label}</button>;
          })}
        </div>
      )}
      {value.length > 0 && (
        <div className="chips">
          {value.map((v) => (
            <span key={v.code} className="code-chip" title={v.title}><b>{v.code}</b> {v.title}<button type="button" aria-label={`Retirer ${v.code}`} onClick={() => remove(v.code)}>×</button></span>
          ))}
        </div>
      )}
      <div className="scian-search">
        <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)}
          placeholder="Chercher une activité : uñas, barbería, coiffure, dentiste, spa, restaurante… ou un code" aria-label="Chercher une activité SCIAN" />
        {busy && <span className="tiny muted scian-busy">…</span>}
        {open && q.trim().length >= 2 && (
          <div className="scian-hits" role="listbox">
            {hits.length === 0 && !busy && <div className="small muted" style={{ padding: 10 }}>Aucune activité trouvée. Essaie un mot espagnol (« peluquería », « belleza »).</div>}
            {hits.map((h) => (
              <button key={h.code} type="button" role="option" aria-selected={has(h.code)} className={has(h.code) ? "on" : ""}
                onClick={() => { has(h.code) ? remove(h.code) : add([{ code: h.code, title: h.title }]); }}>
                <span className="row spread" style={{ flexWrap: "nowrap" }}><b>{h.code}</b><span className="tiny muted">{LEVEL[h.level]}{has(h.code) ? " · ✓" : ""}</span></span>
                <span>{h.title}</span>
                {h.match && <span className="tiny muted">contient : {h.match}</span>}
              </button>
            ))}
            <button type="button" className="close" onClick={() => setOpen(false)}>Fermer</button>
          </div>
        )}
      </div>
      <span className="tiny muted">Catalogue officiel SCIAN 2023 (INEGI). Une classe (6 chiffres) est la plus précise ; une branche (4 chiffres) regroupe plusieurs classes.</span>
    </div>
  );
}
