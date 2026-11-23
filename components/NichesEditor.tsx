"use client";
import { useEffect, useState } from "react";
import { getJson, postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import ActivityPicker from "./denue/ActivityPicker";
import type { Code } from "./denue/types";

type N = { label: string; codes: string[]; titles: string[] };

// Réglages > DENUE > Mes niches : libellé de niche du CRM → codes SCIAN (niche remplie à l'ajout depuis DENUE,
// raccourcis de recherche, tableau « Marché »).
export default function NichesEditor() {
  const [list, setList] = useState<N[] | null>(null);
  const [edit, setEdit] = useState<{ i: number; label: string; codes: Code[] } | null>(null);
  useEffect(() => { getJson<{ niches: N[] }>("/api/settings/niches").then((r) => setList(r.niches)).catch(toastError); }, []);

  async function save(next: N[] | null) {
    try {
      const r = await postJson<{ niches: N[] }>("/api/settings/niches", next ? { niches: next.map(({ label, codes }) => ({ label, codes })) } : { reset: true });
      setList(r.niches); setEdit(null); toast("Niches enregistrées.");
    } catch (e) { toastError(e); }
  }
  if (!list) return <div className="card small muted">Chargement…</div>;
  const commit = () => {
    if (!edit) return;
    const label = edit.label.trim();
    if (!label || !edit.codes.length) return toast("Libellé et au moins un code SCIAN.", { kind: "err" });
    const item = { label, codes: edit.codes.map((c) => c.code), titles: edit.codes.map((c) => c.title) };
    save(edit.i < 0 ? [...list, item] : list.map((x, j) => (j === edit.i ? item : x)));
  };
  return (
    <div className="card stack" id="niches">
      <div className="row spread"><b>Mes niches</b>
        <span className="row"><button className="btn sm" onClick={() => setEdit({ i: -1, label: "", codes: [] })}>＋ Nouvelle niche</button>
          <button className="btn sm ghost" onClick={() => confirm("Revenir aux niches par défaut (construites depuis le catalogue SCIAN) ?") && save(null)}>Par défaut</button></span></div>
      <p className="small muted" style={{ margin: 0 }}>Le libellé est écrit dans le champ « Niche » des fiches ajoutées depuis DENUE (le code le plus précis l'emporte). Utilisez les mêmes libellés que dans vos fiches pour le tableau « Marché ».</p>
      {list.map((n, i) => (
        <div key={n.label} className="niche-row">
          <div style={{ minWidth: 0 }}><b>{n.label}</b><div className="tiny muted">{n.codes.map((c, j) => `${c} ${n.titles[j] ?? ""}`).join(" · ")}</div></div>
          <span className="row" style={{ flexWrap: "nowrap" }}>
            <button className="btn sm" onClick={() => setEdit({ i, label: n.label, codes: n.codes.map((c, j) => ({ code: c, title: n.titles[j] ?? "" })) })}>Modifier</button>
            <button className="btn sm ghost danger" onClick={() => confirm(`Supprimer « ${n.label} » ?`) && save(list.filter((_, j) => j !== i))}>×</button>
          </span>
        </div>
      ))}
      {edit && (
        <div className="card stack" style={{ background: "var(--panel2)" }}>
          <label className="f">Libellé de la niche<input value={edit.label} maxLength={100} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder="ex. Beauté & coiffure" /></label>
          <ActivityPicker value={edit.codes} onChange={(codes) => setEdit({ ...edit, codes })} niches={[]} required />
          <div className="row"><button className="btn primary" onClick={commit}>Enregistrer</button><button className="btn ghost" onClick={() => setEdit(null)}>Annuler</button></div>
        </div>
      )}
    </div>
  );
}
