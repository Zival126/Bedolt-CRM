"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import SourceResults, { type SRow } from "./SourceResults";
import NicheChips from "../NicheChips";
import { Step } from "../SourceHead";
import type { Bounds } from "../denue/DenueMap";
import type { TileConfig } from "@/lib/tiles";
import type { NicheLite } from "@/lib/niche-style";

const DenueMap = dynamic(() => import("../denue/DenueMap"), { ssr: false, loading: () => <div className="denue-map-wrap"><div className="denue-map skel" /></div> });
type Town = { code: string; nom: string; p: number };
type Preset = NicheLite & { tags: string[] };
type Msg = { kind: "" | "warn" | "bad"; text: string; retry?: boolean };

// OpenStreetMap (Overpass) : 1. Où (ville ou carte visible) 2. Quoi (niches → tags) 3. Options avancées 4. Chercher.
export default function OsmPanel({ presets, categories, towns, tiles, niches }: {
  presets: Preset[]; categories: string[]; towns: Town[]; tiles: TileConfig; niches: NicheLite[];
}) {
  const [ids, setIds] = useState<number[]>(presets[0] ? [presets[0].id] : []);
  const [extra, setExtra] = useState<string[]>([]);
  const [zone, setZone] = useState<"carte" | string>(towns[0]?.code ?? "carte");
  const [rows, setRows] = useState<SRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [prefer, setPrefer] = useState(0);
  const bounds = useRef<Bounds | null>(null);
  const abort = useRef<AbortController | null>(null);
  const tags = [...new Set([...presets.filter((p) => ids.includes(p.id)).flatMap((p) => p.tags), ...extra])];
  const toggle = (t: string) => setExtra((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]));

  async function search(server = prefer) {
    if (!tags.length) return setMsg({ kind: "warn", text: "Choisis au moins une niche (ou une catégorie OSM dans les options avancées)." });
    const b = bounds.current;
    if (zone === "carte" && !b) return setMsg({ kind: "warn", text: "La carte n'est pas encore chargée : réessaie dans un instant." });
    abort.current?.abort();
    const ac = new AbortController(); abort.current = ac;
    setBusy(true); setSelected(null); setMsg({ kind: "", text: "Recherche sur OpenStreetMap…" });
    try {
      const body = zone === "carte" ? { tags, bbox: b, prefer: server } : { tags, ville: zone, prefer: server };
      const res = await fetch("/api/sources/osm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw Object.assign(new Error((j as { error?: string }).error ?? "La recherche n'a pas pu démarrer."), { retry: false }); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "tile") setMsg({ kind: "", text: `Grande zone : partie ${ev.tile} sur ${ev.tiles}…` });
          else if (ev.type === "wait") setMsg({ kind: "warn", text: `Serveur OSM ${ev.server} saturé (${ev.reason}) : nouvel essai automatique dans ${ev.seconds} s avec ${ev.next}…` });
          else if (ev.type === "error") throw Object.assign(new Error(ev.error), { retry: ev.retryable });
          else if (ev.type === "done") {
            setRows(ev.rows);
            setLabel(`OSM ${presets.filter((p) => ids.includes(p.id)).map((p) => p.label).join(", ") || tags.join(", ")} · ${zone === "carte" ? "zone de la carte" : towns.find((m) => m.code === zone)?.nom ?? zone}`);
            setMsg({ kind: "", text: ev.rows.length
              ? `${ev.rows.length} établissement(s) trouvés${ev.cached ? " (résultat gardé moins de 24 h)" : ev.server ? ` via ${ev.server}` : ""}${ev.base ? ` · données OSM du ${ev.base.slice(0, 10)}` : ""}${ev.truncated ? " · beaucoup de résultats : réduis la zone pour tout voir" : ""}.`
              : "Aucun établissement avec un nom dans cette zone. OpenStreetMap a peu de commerces au Mexique : essaie DENUE ou Overture." });
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg({ kind: "bad", text: (e as Error).message, retry: (e as { retry?: boolean }).retry !== false });
    }
    setBusy(false);
  }

  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="card stack" style={{ gap: 18 }}>
        <Step n={1} title="Où">
          <select value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zone" style={{ maxWidth: 420 }}>
            {towns.map((t) => <option key={t.code} value={t.code}>{t.nom} ({t.p.toLocaleString("fr-FR")} hab.)</option>)}
            <option value="carte">Zone visible de la carte ci-dessous</option>
          </select>
        </Step>
        <Step n={2} title="Quoi" hint="niches à chercher">
          {presets.length ? <NicheChips niches={presets} value={ids} onChange={setIds} clearLabel="Tout décocher" /> : <span className="small muted">Aucune niche n'a de tag OpenStreetMap : ajoute-en dans la page Niches, ou choisis des catégories ci-dessous.</span>}
        </Step>
        <Step n={3} title="Options avancées">
          <details>
            <summary className="small muted">Catégories OpenStreetMap ({tags.length} utilisée{tags.length > 1 ? "s" : ""})</summary>
            <div className="chips" style={{ marginTop: 8 }}>
              {categories.map((t) => { const on = tags.includes(t); const fromNiche = on && !extra.includes(t);
                return <button key={t} type="button" className={on ? "on" : ""} aria-pressed={on} disabled={fromNiche} title={fromNiche ? "Incluse par une niche choisie" : undefined} onClick={() => toggle(t)}><code>{t}</code></button>; })}
            </div>
          </details>
        </Step>
        <div className="stack" style={{ gap: 8 }}>
          <p className="step-t"><span className="step-n">4</span>Chercher</p>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy} onClick={() => search()}>{busy ? "Recherche…" : "Chercher sur OpenStreetMap"}</button>
            {busy && <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>Arrêter</button>}
          </div>
          {msg && (
            <div className={msg.kind === "bad" ? "banner bad" : msg.kind === "warn" ? "banner warn" : "small muted"} role="status">
              {msg.text}
              {msg.kind === "bad" && msg.retry && !busy && <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="btn sm" onClick={() => { const n = prefer + 1; setPrefer(n); search(n); }}>Réessayer avec un autre serveur</button>
                <button type="button" className="btn sm ghost" onClick={() => search()}>Réessayer</button></div>}
            </div>
          )}
        </div>
      </div>
      <DenueMap tiles={tiles} rows={rows.map((r) => ({ clee: r.sourceId, nom: r.nom, activite: r.categorie, lat: r.lat, lng: r.lng, existing: r.existing }))}
        point={null} rayon={0} picking={false} onPick={() => {}} selected={selected}
        onSelect={(c) => { setSelected(c); document.getElementById("r-" + c)?.scrollIntoView({ block: "nearest" }); }}
        onBounds={(b) => { bounds.current = b; }} />
      {rows.length > 0 && <SourceResults key={label + rows.length} rows={rows} setRows={setRows} label={label} selected={selected} onSelect={setSelected} niches={niches} />}
    </section>
  );
}
