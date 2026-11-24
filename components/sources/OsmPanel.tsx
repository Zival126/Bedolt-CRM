"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { postJson } from "../client-api";
import SourceResults, { type SRow } from "./SourceResults";
import type { Bounds } from "../denue/DenueMap";
import type { TileConfig } from "@/lib/tiles";

const DenueMap = dynamic(() => import("../denue/DenueMap"), { ssr: false, loading: () => <div className="denue-map-wrap"><div className="denue-map" /></div> });
type Town = { code: string; nom: string; p: number };

// OpenStreetMap (Overpass) : catégories préréglées par niche + catégories libres, zone = carte visible ou municipio.
export default function OsmPanel({ presets, categories, towns, tiles }: {
  presets: { niche: string; tags: string[] }[]; categories: string[]; towns: Town[]; tiles: TileConfig;
}) {
  const [tags, setTags] = useState<string[]>(presets[0]?.tags ?? ["shop=beauty"]);
  const [zone, setZone] = useState<"carte" | string>(towns[0]?.code ?? "carte");
  const [rows, setRows] = useState<SRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const bounds = useRef<Bounds | null>(null);
  const toggle = (t: string) => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]));

  async function search() {
    if (!tags.length) return setMsg({ kind: "warn", text: "Choisis au moins une catégorie." });
    const b = bounds.current;
    if (zone === "carte" && !b) return;
    setBusy(true); setMsg({ kind: "", text: "Requête Overpass en cours (jusqu'à une minute si le serveur est chargé)…" }); setSelected(null);
    try {
      const body = zone === "carte" ? { tags, bbox: b } : { tags, ville: zone };
      const r = await postJson<{ rows: SRow[]; total: number; cached: boolean; truncated: boolean; base: string }>("/api/sources/osm", body);
      setRows(r.rows);
      setLabel(`OSM ${tags.join(", ")} · ${zone === "carte" ? "zone de la carte" : towns.find((m) => m.code === zone)?.nom ?? zone}`);
      setMsg({ kind: "", text: `${r.rows.length} établissement(s) avec un nom${r.total !== r.rows.length ? ` (sur ${r.total} objets OSM)` : ""}${r.cached ? " · depuis le cache (24 h)" : ""}${r.base ? ` · données OSM du ${r.base.slice(0, 10)}` : ""}${r.truncated ? " · limite atteinte : réduis la zone" : ""}.` });
    } catch (e) { setMsg({ kind: "bad", text: (e as Error).message }); }
    setBusy(false);
  }

  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="card stack" style={{ gap: 10 }}>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Préréglages par niche</b>
          <div className="chips scroll">
            {presets.map((p) => { const on = p.tags.every((t) => tags.includes(t)); return (
              <button key={p.niche} type="button" className={on ? "on" : ""} title={p.tags.join(", ")} onClick={() => setTags(on ? tags.filter((t) => !p.tags.includes(t)) : [...new Set([...tags, ...p.tags])])}>{p.niche}</button>); })}
          </div>
        </div>
        <details>
          <summary className="small muted">Catégories OSM ({tags.length} choisie{tags.length > 1 ? "s" : ""})</summary>
          <div className="chips" style={{ marginTop: 8 }}>
            {categories.map((t) => <button key={t} type="button" className={tags.includes(t) ? "on" : ""} onClick={() => toggle(t)}><code>{t}</code></button>)}
          </div>
        </details>
        <div className="grid g2">
          <label className="f">Zone
            <select value={zone} onChange={(e) => setZone(e.target.value)}>
              <option value="carte">Zone visible de la carte</option>
              {towns.map((t) => <option key={t.code} value={t.code}>{t.nom} ({t.p.toLocaleString("fr-FR")} hab.)</option>)}
            </select></label>
          <div className="f" style={{ justifyContent: "flex-end" }}><button type="button" className="btn primary" disabled={busy} onClick={search}>{busy ? "Recherche…" : "Rechercher sur OpenStreetMap"}</button></div>
        </div>
        {msg && <p className={"small " + (msg.kind === "bad" ? "err" : msg.kind === "warn" ? "warn-text" : "muted")} style={{ margin: 0 }} role="status">{msg.text}</p>}
        <p className="tiny muted" style={{ margin: 0 }}>Requêtes faites par le serveur (une à la fois, mises en cache 24 h). Zone : une ville (cadre autour du centre officiel INEGI) ou la carte visible, ~65 km de côté au plus. Données © OpenStreetMap contributors, licence ODbL.</p>
      </div>
      <DenueMap tiles={tiles} rows={rows.map((r) => ({ clee: r.sourceId, nom: r.nom, activite: r.categorie, lat: r.lat, lng: r.lng, existing: r.existing }))}
        point={null} rayon={0} picking={false} onPick={() => {}} selected={selected}
        onSelect={(c) => { setSelected(c); document.getElementById("r-" + c)?.scrollIntoView({ block: "nearest" }); }}
        onBounds={(b) => { bounds.current = b; }} />
      {rows.length > 0 && <SourceResults key={label + rows.length} rows={rows} setRows={setRows} label={label} selected={selected} onSelect={setSelected} />}
    </section>
  );
}
