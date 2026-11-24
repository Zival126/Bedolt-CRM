"use client";
import { useEffect, useState } from "react";
import { getJson, postJson } from "./client-api";
import { toastError } from "./Toast";

type Row = { category: string; niche: string; isDefault: boolean; count?: number };

// Réglages > Sources : catégorie OSM / Overture → niche du CRM. « Par défaut » = règle intégrée ; « — ignorer — » = aucune niche.
export default function CategoryMapEditor() {
  const [source, setSource] = useState<"osm" | "overture">("osm");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [niches, setNiches] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [add, setAdd] = useState("");
  useEffect(() => {
    setRows(null);
    getJson<{ rows: Row[]; niches: string[] }>("/api/settings/category-map?source=" + source).then((r) => { setRows(r.rows); setNiches(r.niches); }).catch(toastError);
  }, [source]);
  async function save(category: string, niche: string | null) {
    try { setRows((await postJson<{ rows: Row[] }>("/api/settings/category-map", { source, category, niche })).rows); } catch (e) { toastError(e); }
  }
  const shown = (rows ?? []).filter((r) => !q || r.category.includes(q.toLowerCase()));
  return (
    <div className="card stack" id="correspondances">
      <div className="row spread"><b>Catégories des sources → Mes niches</b>
        <div className="tabs" style={{ margin: 0 }}>
          <button className={source === "osm" ? "on" : ""} onClick={() => setSource("osm")}>OpenStreetMap</button>
          <button className={source === "overture" ? "on" : ""} onClick={() => setSource("overture")}>Overture</button>
        </div></div>
      <p className="small muted" style={{ margin: 0 }}>La niche est remplie à l'ajout depuis la source. Pour OpenStreetMap, les catégories d'une niche forment aussi son préréglage de recherche.{source === "overture" ? " Catégories Overture présentes dans la copie locale (les plus fréquentes)." : ""}</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer les catégories…" aria-label="Filtrer les catégories" />
      {!rows && <span className="small muted">Chargement…</span>}
      {rows && rows.length === 0 && <span className="small muted">Aucune catégorie (lance d'abord la synchronisation Overture).</span>}
      <div className="catmap">
        {shown.map((r) => (
          <div key={r.category} className="catmap-row">
            <code>{r.category}</code>{r.count ? <span className="tiny muted">{r.count}</span> : <span />}
            <select value={r.isDefault ? "__default" : r.niche === "" ? "__none" : r.niche} aria-label={`Niche pour ${r.category}`}
              onChange={(e) => save(r.category, e.target.value === "__default" ? null : e.target.value === "__none" ? "" : e.target.value)}>
              <option value="__default">Par défaut{r.isDefault ? ` (${r.niche || "aucune"})` : ""}</option>
              <option value="__none">— ignorer —</option>
              {niches.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        ))}
      </div>
      {source === "osm" && (
        <div className="row"><input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Ajouter une catégorie OSM : clé=valeur (ex. shop=cosmetics)" style={{ flex: 1 }} />
          <button className="btn sm" disabled={!/^[a-z_]+=[a-z0-9_;:-]+$/.test(add.trim())} onClick={() => { save(add.trim(), niches[0] ?? ""); setAdd(""); }}>Ajouter</button></div>
      )}
    </div>
  );
}
