"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { COLUMNS, DEFAULT_COLUMNS, type ColumnKey } from "@/lib/columns";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import { MoreMenu } from "./Drawer";

type View = { id: number; name: string; query: string };

// Outils de Commerces (menu « ⋯ ») : vues enregistrées, colonnes du tableau, export CSV.
export default function CommerceTools({ views: initial, query, columns, total }: { views: View[]; query: string; columns: ColumnKey[]; total: number }) {
  const router = useRouter();
  const [views, setViews] = useState(initial);
  const [cols, setCols] = useState<ColumnKey[]>(columns);
  const [open, setOpen] = useState<"" | "cols" | "export" | "views">("");
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
    if (i < 1 || j < 1 || j >= cols.length) return;
    const n = [...cols]; [n[i], n[j]] = [n[j], n[i]]; saveCols(n);
  };
  const exportHref = `/api/commerces/export?${curQ}${curQ ? "&" : ""}sep=${encodeURIComponent(sep)}&cols=${cols.join(",")}`;

  return (
    <>
      <MoreMenu label="Vues, colonnes, export">
        <button type="button" onClick={() => setOpen("views")}>Mes vues enregistrées ({views.length})</button>
        <button type="button" onClick={saveView}>Enregistrer ces filtres comme vue…</button>
        <button type="button" className="only-desk-inline" onClick={() => setOpen("cols")}>Colonnes du tableau…</button>
        <button type="button" onClick={() => setOpen("export")}>Exporter en CSV…</button>
      </MoreMenu>
      {open && (
        <div className="modal" onClick={() => setOpen("")}>
          <div className="card stack" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Outils">
            {open === "views" && <>
              <b>Vues enregistrées</b>
              <p className="small muted" style={{ margin: 0 }}>Une vue = un jeu de filtres que tu rouvres en un clic.</p>
              {views.length === 0 && <span className="small muted">Aucune vue. Filtre la liste puis « Enregistrer ces filtres comme vue ».</span>}
              {views.map((v) => (
                <div key={v.id} className="row spread" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
                  <Link href={"/commerces?" + v.query} onClick={() => setOpen("")}>{v.query === curQ ? "✓ " : ""}{v.name}</Link>
                  <button type="button" className="btn sm ghost danger" onClick={() => delView(v)}>Supprimer</button>
                </div>))}
              <div className="row"><button type="button" className="btn sm" onClick={saveView}>＋ Enregistrer les filtres actuels</button></div>
            </>}
            {open === "cols" && <>
              <div className="row spread"><b>Colonnes du tableau (ordinateur)</b><button type="button" className="btn sm ghost" onClick={() => saveCols(null)}>Par défaut</button></div>
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
            </>}
            {open === "export" && <>
              <b>Exporter en CSV</b>
              <span className="small">{total.toLocaleString("fr-FR")} fiche(s) · colonnes visibles du tableau · UTF-8 (accents et emojis OK dans Excel)</span>
              <label className="f">Séparateur<select value={sep} onChange={(e) => setSep(e.target.value)}>
                <option value=";">« ; » (Excel en français)</option><option value=",">« , » (Excel en espagnol / anglais)</option></select></label>
              <div className="row"><a className="btn primary" href={exportHref} download>Télécharger le CSV</a></div>
            </>}
            <div><button type="button" className="btn ghost" onClick={() => setOpen("")}>Fermer</button></div>
          </div>
        </div>
      )}
    </>
  );
}
