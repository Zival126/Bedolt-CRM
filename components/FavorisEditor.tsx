"use client";
import { useEffect, useState } from "react";
import { getJson, postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import ZonePicker, { type ZoneVal } from "./ZonePicker";

type Fav = ZoneVal & { full?: string };

// Réglages > DENUE > Zones favorites : puces 1 clic au-dessus du choix de zone (DENUE).
export default function FavorisEditor({ entidades }: { entidades: { code: string; nom: string }[] }) {
  const [list, setList] = useState<Fav[] | null>(null);
  const [z, setZ] = useState<ZoneVal>({ ent: "", mun: "", loc: "", label: "" });
  const [label, setLabel] = useState("");
  useEffect(() => { getJson<{ favoris: Fav[] }>("/api/geo/favoris").then((r) => setList(r.favoris)).catch(toastError); }, []);
  async function save(next: Fav[] | null) {
    try { setList((await postJson<{ favoris: Fav[] }>("/api/geo/favoris", next ? { favoris: next.map(({ ent, mun, loc, label }) => ({ ent, mun, loc, label })) } : { reset: true })).favoris); toast("Favoris enregistrés."); }
    catch (e) { toastError(e); }
  }
  if (!list) return <div className="card small muted">Chargement…</div>;
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= list.length) return; const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; save(n); };
  return (
    <div className="card stack" id="favoris">
      <div className="row spread"><b>Zones favorites (DENUE)</b>
        <button className="btn sm ghost" onClick={() => confirm("Revenir aux favoris par défaut ?") && save(null)}>Par défaut</button></div>
      <div className="stack" style={{ gap: 4 }}>
        {list.map((f, i) => (
          <div key={f.ent + f.mun + f.loc} className="niche-row">
            <div style={{ minWidth: 0 }}><b>{f.label}</b><div className="tiny muted">{f.full}</div></div>
            <span className="row" style={{ flexWrap: "nowrap", gap: 2 }}>
              <button className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Monter">↑</button>
              <button className="btn sm ghost" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Descendre">↓</button>
              <button className="btn sm ghost danger" onClick={() => save(list.filter((_, j) => j !== i))} aria-label={`Retirer ${f.label}`}>×</button>
            </span>
          </div>
        ))}
      </div>
      <div className="card stack" style={{ background: "var(--panel2)" }}>
        <ZonePicker value={z} onChange={(v) => { setZ(v); setLabel(v.label.split(" — ")[0].split(" (")[0]); }} entidades={entidades} favoris={[]} label="Ajouter une zone" />
        <div className="row"><input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="Nom court de la puce" style={{ flex: 1 }} aria-label="Nom de la puce" />
          <button className="btn sm primary" disabled={!z.ent || list.length >= 40} onClick={() => { save([...list, { ...z, label: label.trim() || z.label }]); setZ({ ent: "", mun: "", loc: "", label: "" }); setLabel(""); }}>Ajouter</button></div>
      </div>
    </div>
  );
}
