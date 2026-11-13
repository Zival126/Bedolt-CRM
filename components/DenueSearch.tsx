"use client";
import { useState } from "react";
import Link from "next/link";
import { FICHES, INTERETS } from "@/lib/constants";
import { mapsSearchUrl, prettyPhone } from "@/lib/phone";

type Row = { clee: string; nom: string; activite: string; adresse: string; colonia: string; ville: string; telephone: string; estrato: string; ubicacion: string; existingId: number | null; [k: string]: unknown };
type Qual = { fiche_google: string; interet: string; note: string };
type Muni = { code: string; nom: string };
const STRATES = [["", "Toutes tailles"], ["1", "1 · 0-5 employés"], ["2", "2 · 6-10"], ["3", "3 · 11-30"], ["4", "4 · 31-50"], ["5", "5 · 51-100"], ["6", "6 · 101-250"], ["7", "7 · 251+"]];
const SIZE = 20;

export default function DenueSearch({ municipios, entidad }: { municipios: Muni[]; entidad: string }) {
  const [mode, setMode] = useState<"zone" | "nom" | "point">("zone");
  const [f, setF] = useState({ municipio: "", muniCustom: "", scian: "812110", strate: "1", nom: "", lat: "", lng: "", rayon: "1000", cond: "" });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [qual, setQual] = useState<Record<string, Qual>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const q = (r: Row) => qual[r.clee] ?? { fiche_google: "", interet: "", note: "" };
  const setQ = (r: Row, p: Partial<Qual>) => setQual({ ...qual, [r.clee]: { ...q(r), ...p } });

  async function search(p = 1) {
    setBusy(true); setMsg(""); setPage(p); setSel(new Set());
    const municipio = f.municipio === "custom" ? f.muniCustom : f.municipio;
    const body =
      mode === "zone" ? { mode, entidad, municipio, scian: f.scian, strate: f.strate, page: p, size: SIZE } :
      mode === "nom" ? { mode, nom: f.nom, entidad, page: p, size: SIZE } :
      { mode, lat: Number(f.lat), lng: Number(f.lng), rayon: Number(f.rayon), condition: f.cond };
    const r = await fetch("/api/denue/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setRows([]); return setMsg("⚠️ " + j.error); }
    setRows(j.rows);
    if (!j.rows.length) setMsg("Aucun résultat.");
  }

  async function add(list: Row[]) {
    if (!list.length) return;
    setBusy(true);
    const items = list.map((r) => ({ ...r, ...q(r) }));
    const r = await fetch("/api/denue/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
    const j = await r.json();
    setBusy(false);
    setRows((all) => all.map((x) => (j.ids[x.clee] ? { ...x, existingId: j.ids[x.clee] } : x)));
    setSel(new Set());
    setMsg(`${j.added} ajouté(s) en « À contacter »${j.skipped ? `, ${j.skipped} déjà présent(s)` : ""}.`);
  }

  const gps = () => navigator.geolocation?.getCurrentPosition((p) => setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })), () => setMsg("Position refusée."));
  const addable = rows.filter((r) => !r.existingId);
  const paged = mode !== "point";

  return (
    <>
      <div className="tabs">
        {([["zone", "Zone + activité"], ["nom", "Par nom"], ["point", "Autour d'un point"]] as const).map(([k, l]) => (
          <button key={k} className={mode === k ? "on" : ""} onClick={() => { setMode(k); setRows([]); setMsg(""); }}>{l}</button>
        ))}
      </div>
      <form className="card grid gform" onSubmit={(e) => { e.preventDefault(); search(1); }}>
        {mode === "zone" && <>
          <label className="f">Municipio (Quintana Roo = {entidad})
            <select value={f.municipio} onChange={set("municipio")}>
              <option value="">Tous les municipios</option>
              {municipios.map((m) => <option key={m.code} value={m.code}>{m.nom} — {m.code}</option>)}
              <option value="custom">Autre code…</option>
            </select></label>
          {f.municipio === "custom" && <label className="f">Code municipio (3 chiffres)<input value={f.muniCustom} onChange={set("muniCustom")} placeholder="ex. 008" /></label>}
          <label className="f">Code SCIAN (2, 3, 4 ou 6 chiffres)<input value={f.scian} onChange={set("scian")} inputMode="numeric" /></label>
          <label className="f">Taille (strate)<select value={f.strate} onChange={set("strate")}>{STRATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </>}
        {mode === "nom" && <label className="f full">Nom du commerce<input value={f.nom} onChange={set("nom")} required /></label>}
        {mode === "point" && <>
          <label className="f">Latitude<input value={f.lat} onChange={set("lat")} inputMode="decimal" required /></label>
          <label className="f">Longitude<input value={f.lng} onChange={set("lng")} inputMode="decimal" required /></label>
          <label className="f">Rayon (m, max 5 000)<input value={f.rayon} onChange={set("rayon")} inputMode="numeric" /></label>
          <label className="f">Mot-clé (optionnel)<input value={f.cond} onChange={set("cond")} placeholder="todos" /></label>
          <button type="button" className="btn" onClick={gps}>Ma position</button>
        </>}
        <button className="btn primary" disabled={busy}>{busy ? "Recherche…" : "Rechercher"}</button>
      </form>
      {msg && <p className="small" style={{ margin: "10px 0" }}>{msg}</p>}

      {rows.length > 0 && (
        <div className="row spread" style={{ margin: "12px 0" }}>
          <span className="small muted">{rows.length} résultat(s){paged ? ` · page ${page}` : ""} · {sel.size} sélectionné(s)</span>
          <span className="row">
            <button className="btn sm" onClick={() => setSel(new Set(addable.map((r) => r.clee)))}>Tout cocher</button>
            <button className="btn sm primary" disabled={!sel.size || busy} onClick={() => add(rows.filter((r) => sel.has(r.clee)))}>Ajouter la sélection ({sel.size})</button>
          </span>
        </div>
      )}
      <div className="list">
        {rows.map((r) => (
          <div key={r.clee} className="item stack">
            <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
              {!r.existingId && <input type="checkbox" checked={sel.has(r.clee)} onChange={() => setSel((s) => { const n = new Set(s); n.has(r.clee) ? n.delete(r.clee) : n.add(r.clee); return n; })} style={{ marginTop: 3 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row spread"><span className="t">{r.nom}</span>
                  {r.existingId ? <Link href={`/commerces/${r.existingId}`} className="badge ok">Déjà dans le CRM</Link> : null}</div>
                <div className="s">{r.activite} {r.estrato && `· ${r.estrato}`}</div>
                <div className="s">{[r.adresse, r.colonia, r.ubicacion].filter(Boolean).join(" · ")}</div>
                <div className="s">{r.telephone ? prettyPhone(r.telephone) : "pas de téléphone"}</div>
              </div>
            </div>
            {!r.existingId && (
              <>
                <div className="row">
                  <select value={q(r).fiche_google} onChange={(e) => setQ(r, { fiche_google: e.target.value })} style={{ flex: 1, minWidth: 130 }} aria-label="Fiche Google">
                    {FICHES.map((x) => <option key={x.key} value={x.key}>{x.key ? `Fiche : ${x.label}` : "Fiche : ?"}</option>)}</select>
                  <select value={q(r).interet} onChange={(e) => setQ(r, { interet: e.target.value })} style={{ flex: 1, minWidth: 110 }} aria-label="Intérêt">
                    {INTERETS.map((x) => <option key={x.key} value={x.key}>{x.key ? x.label : "Intérêt : ?"}</option>)}</select>
                </div>
                <input placeholder="Note courte" value={q(r).note} onChange={(e) => setQ(r, { note: e.target.value })} />
                <div className="row">
                  <a className="btn sm" target="_blank" rel="noreferrer" href={mapsSearchUrl(r.nom, r.ville || String(r.ubicacion))}>Chercher sur Google Maps</a>
                  <button className="btn sm primary" disabled={busy} onClick={() => add([r])}>Ajouter</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {paged && rows.length > 0 && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" disabled={page <= 1 || busy} onClick={() => search(page - 1)}>← Précédent</button>
          <button className="btn" disabled={rows.length < SIZE || busy} onClick={() => search(page + 1)}>Suivant →</button>
        </div>
      )}
    </>
  );
}
