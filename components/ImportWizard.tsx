"use client";
import { useState } from "react";
import Link from "next/link";
import { normHeader } from "@/lib/import-shared";

type Parsed = { fileName: string; headers: string[]; rows: string[][]; mapping: Record<string, number>; fields: string[] };
type Prev = { total: number; valid: number; errors: { line: number; nom?: string; error?: string }[]; duplicates: { line: number; nom?: string; duplicate: { id: number; nom: string; reason: string } }[] };

export default function ImportWizard() {
  const [p, setP] = useState<Parsed | null>(null);
  const [map, setMap] = useState<Record<string, number>>({});
  const [prev, setPrev] = useState<Prev | null>(null);
  const [dup, setDup] = useState<"ignore" | "update">("ignore");
  const [res, setRes] = useState<{ added: number; updated: number; ignored: number; errors: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setMsg(""); setPrev(null); setRes(null);
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch("/api/import/parse", { method: "POST", body: fd });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setMsg("⚠️ " + j.error);
    setP(j); setMap(j.mapping);
  }
  const post = (url: string, body: object) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

  async function doPreview() {
    setBusy(true); setPrev(await post("/api/import/preview", { rows: p!.rows, mapping: map })); setBusy(false);
  }
  async function doImport() {
    setBusy(true); setRes(await post("/api/import/commit", { rows: p!.rows, mapping: map, fileName: p!.fileName, onDuplicate: dup })); setBusy(false);
  }
  const exact = p && p.fields.every((f) => map[f] !== undefined && normHeader(p.headers[map[f]]) === normHeader(f));
  const allMapped = p && p.fields.filter((f) => map[f] !== undefined).length;

  return (
    <>
      <div className="card stack">
        <div className="row">
          <a className="btn" href="/api/import/template">Télécharger modele-import-bedolt.xlsx</a>
          <label className="btn primary" style={{ cursor: "pointer" }}>Choisir un fichier .xlsx / .csv
            <input type="file" accept=".xlsx,.csv" onChange={upload} hidden /></label>
        </div>
        <p className="small muted">1 ligne = 1 commerce, ligne 1 = en-têtes, seule « nom » est obligatoire. fiche_google : oui / non / vide.</p>
      </div>
      {msg && <p className="err">{msg}</p>}

      {p && !res && (
        <>
          <h2>Colonnes — {p.fileName} ({p.rows.length} lignes)</h2>
          <div className="card stack">
            <p className="small muted">{exact ? "Toutes les en-têtes correspondent." : `${allMapped}/${p.fields.length} champs reconnus. Vérifie ou corrige la correspondance :`}</p>
            <div className="grid gform">
              {p.fields.map((f) => (
                <label key={f} className="f">{f}{f === "nom" ? " *" : ""}
                  <select value={map[f] ?? ""} onChange={(e) => { const m = { ...map }; if (e.target.value === "") delete m[f]; else m[f] = Number(e.target.value); setMap(m); setPrev(null); }}>
                    <option value="">— ignorer —</option>
                    {p.headers.map((h, i) => <option key={i} value={i}>{h || `(colonne ${i + 1})`}</option>)}
                  </select></label>
              ))}
            </div>
            <div><button className="btn primary" disabled={busy || map.nom === undefined} onClick={doPreview}>Aperçu avant import</button>
              {map.nom === undefined && <span className="err small"> Associe la colonne « nom ».</span>}</div>
          </div>
        </>
      )}

      {prev && !res && (
        <>
          <h2>Aperçu</h2>
          <div className="card stack">
            <div className="row"><span className="badge ok">{prev.valid} valides</span><span className="badge bad">{prev.errors.length} en erreur</span><span className="badge warn">{prev.duplicates.length} doublons</span></div>
            {prev.errors.length > 0 && <details open><summary>Lignes en erreur</summary>
              <table><tbody>{prev.errors.slice(0, 100).map((e) => <tr key={e.line}><td>L{e.line}</td><td>{e.nom}</td><td className="err">{e.error}</td></tr>)}</tbody></table></details>}
            {prev.duplicates.length > 0 && <>
              <details><summary>Doublons détectés</summary>
                <table><tbody>{prev.duplicates.slice(0, 100).map((d) => <tr key={d.line}><td>L{d.line}</td><td>{d.nom}</td><td><Link href={`/commerces/${d.duplicate.id}`}>{d.duplicate.nom}</Link> ({d.duplicate.reason})</td></tr>)}</tbody></table></details>
              <label className="f" style={{ maxWidth: 320 }}>Pour les doublons
                <select value={dup} onChange={(e) => setDup(e.target.value as "ignore" | "update")}>
                  <option value="ignore">Ignorer</option><option value="update">Mettre à jour la fiche existante</option></select></label>
            </>}
            <div><button className="btn primary" disabled={busy || (prev.valid === 0 && !(dup === "update" && prev.duplicates.length))} onClick={doImport}>Importer</button></div>
          </div>
        </>
      )}

      {res && (
        <div className="banner ok" style={{ marginTop: 14 }}>
          Import terminé : {res.added} ajouté(s), {res.updated} mis à jour, {res.ignored} ignoré(s), {res.errors} erreur(s). <Link href="/commerces">Voir les commerces →</Link>
        </div>
      )}
    </>
  );
}
