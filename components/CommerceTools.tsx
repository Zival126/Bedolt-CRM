"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { COLUMNS, DEFAULT_COLUMNS, type ColumnKey } from "@/lib/columns";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";

type View = { id: number; name: string; query: string };

// Barre d'outils de Commerces : vues enregistrées (1 clic), colonnes du tableau, export CSV.
export default function CommerceTools({ views: initial, query, columns, total }: { views: View[]; query: string; columns: ColumnKey[]; total: number }) {
  const router = useRouter();
  const [views, setViews] = useState(initial);
  const [cols, setCols] = useState<ColumnKey[]>(columns);
  const [open, setOpen] = useState<"" | "cols" | "export">("");
  const [sep, setSep] = useState(";");
  const current = new URLSearchParams(query); current.delete("page");
  const curQ = current.toString();

  async function saveView() {
    const name = prompt("Nom de la vue (ex. « Beauté Cancún sans site avec email ») :")?.trim();
    if (!name) return;
    try { setViews((await postJson<{ views: View[] }>("/api/views", { action: "save", name: name.slice(0, 80), query: curQ })).views); toast(`Vue « ${name} » enregistrée.`); }
    catch (e) { toastError(e); }
  }
  async function delView(v: View) {
    if (!confirm(`Supprimer la vue « ${v.name} » ?`)) return;
    try { setViews((await postJson<{ views: View[] }>("/api/views", { action: "delete", id: v.id })).views); } catch (e) { toastError(e); }
  }
  async function saveCols(next: ColumnKey[] | null) {
    try {
      const r = await postJson<{ columns: ColumnKey[] }>("/api/settings/columns", next ? { columns: next } : { reset: true });
      setCols(r.columns); router.refresh();
    } catch (e) { toastError(e); }
  }
  const toggle = (k: ColumnKey) => saveCols(cols.includes(k) ? cols.filter((c) => c !== k) : [...cols, k]);
  const move = (k: ColumnKey, d: -1 | 1) => {
    const i = cols.indexOf(k), j = i + d;
    if (i < 1 || j < 1 || j >= cols.length) return;   // « Commerce » reste en premier
    const n = [...cols]; [n[i], n[j]] = [n[j], n[i]]; saveCols(n);
  };
  const exportHref = `/api/commerces/export?${curQ}${curQ ? "&" : ""}sep=${encodeURIComponent(sep)}&cols=${cols.join(",")}`;

  return (
    <div className="stack" style={{ gap: 8, margin: "8px 0" }}>
      <div className="row tools-row" style={{ gap: 6 }}>
        <span className="small muted">Vues :</span>
        <div className="chips scroll tools-views">
          {views.length === 0 && <span className="tiny muted">aucune (enregistre les filtres actuels →)</span>}
          {views.map((v) => (
            <span key={v.id} className="view-chip">
              <Link href={"/commerces?" + v.query} className={v.query === curQ ? "on" : ""}>{v.name}</Link>
              <button type="button" aria-label={`Supprimer la vue ${v.name}`} onClick={() => delView(v)}>×</button>
            </span>
          ))}
        </div>
        <button type="button" className="btn sm" onClick={saveView}>＋ Enregistrer la vue</button>
        <button type="button" className="btn sm only-desk-inline" aria-expanded={open === "cols"} onClick={() => setOpen(open === "cols" ? "" : "cols")}>Colonnes</button>
        <button type="button" className="btn sm" aria-expanded={open === "export"} onClick={() => setOpen(open === "export" ? "" : "export")}>Exporter CSV</button>
      </div>
      {open === "cols" && (
        <div className="card stack" style={{ padding: 12 }}>
          <div className="row spread"><b className="small">Colonnes du tableau (ordinateur)</b>
            <button type="button" className="btn sm ghost" onClick={() => saveCols(null)}>Par défaut</button></div>
          <div className="colpick">
            {cols.map((k, i) => (
              <div key={k} className="colrow on">
                <label className="chk small"><input type="checkbox" checked disabled={k === "nom"} onChange={() => toggle(k)} />{COLUMNS.find((c) => c.key === k)!.label}</label>
                <span className="row" style={{ gap: 2, flexWrap: "nowrap" }}>
                  <button type="button" className="btn sm ghost" disabled={i < 2} onClick={() => move(k, -1)} aria-label="Monter">↑</button>
                  <button type="button" className="btn sm ghost" disabled={i === 0 || i === cols.length - 1} onClick={() => move(k, 1)} aria-label="Descendre">↓</button>
                </span>
              </div>
            ))}
            {COLUMNS.filter((c) => !cols.includes(c.key)).map((c) => (
              <div key={c.key} className="colrow"><label className="chk small muted"><input type="checkbox" checked={false} onChange={() => toggle(c.key)} />{c.label}</label></div>
            ))}
          </div>
          {cols.join() === DEFAULT_COLUMNS.join() && <span className="tiny muted">Colonnes par défaut.</span>}
        </div>
      )}
      {open === "export" && (
        <div className="card row" style={{ padding: 12 }}>
          <span className="small">{total.toLocaleString("fr-FR")} fiche(s) · colonnes visibles du tableau · UTF-8 (accents et emojis OK dans Excel)</span>
          <select value={sep} onChange={(e) => setSep(e.target.value)} style={{ width: "auto" }} aria-label="Séparateur">
            <option value=";">Séparateur « ; » (Excel en français)</option><option value=",">Séparateur « , » (Excel en espagnol / anglais)</option>
          </select>
          <a className="btn primary sm" href={exportHref} download>Télécharger</a>
        </div>
      )}
    </div>
  );
}
