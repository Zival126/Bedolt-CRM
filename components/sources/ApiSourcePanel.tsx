"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { postJson } from "../client-api";
import SourceResults, { type SRow } from "./SourceResults";
import NicheChips from "../NicheChips";
import ZonePicker, { type ZoneVal } from "../ZonePicker";
import { Step } from "../SourceHead";
import type { Bounds } from "../denue/DenueMap";
import type { TileConfig } from "@/lib/tiles";
import type { NicheLite } from "@/lib/niche-style";

const DenueMap = dynamic(() => import("../denue/DenueMap"), { ssr: false, loading: () => <div className="denue-map-wrap"><div className="denue-map skel" /></div> });
type Res = { rows: SRow[]; calls: number; cached: number; skipped: string[]; used: number; cap: number; attribution: string; error?: string };

// Source API de lieux : 1. Où (ville ou carte, rayon) 2. Quoi (niches) 3. Options 4. Chercher → Ajouter / Compléter.
export default function ApiSourcePanel({ provider, label, enabled, used: used0, cap, restricted, niches, entidades, favoris, defaultZone, tiles, attribution }: {
  provider: "foursquare" | "here" | "tomtom" | "google"; label: string; enabled: boolean; used: number; cap: number; restricted: boolean;
  niches: NicheLite[]; entidades: { code: string; nom: string }[]; favoris: ZoneVal[]; defaultZone: ZoneVal; tiles: TileConfig; attribution: string;
}) {
  const [zone, setZone] = useState<ZoneVal>(defaultZone);
  const [where, setWhere] = useState<"zone" | "carte">(defaultZone.lat != null ? "zone" : "carte");
  const [radius, setRadius] = useState(3000);
  const [limit, setLimit] = useState(50);
  const [ids, setIds] = useState<number[]>(niches[0] ? [niches[0].id] : []);
  const [rows, setRows] = useState<SRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "" | "warn" | "bad"; text: string } | null>(null);
  const [used, setUsed] = useState(used0);
  const [selected, setSelected] = useState<string | null>(null);
  const [lbl, setLbl] = useState("");
  const bounds = useRef<Bounds | null>(null);
  const left = Math.max(0, cap - used);

  function center(): { lat: number; lng: number; radius: number } | null {
    if (where === "zone") return zone.lat != null && zone.lng != null ? { lat: zone.lat, lng: zone.lng!, radius } : null;
    const b = bounds.current;
    if (!b) return null;
    const lat = (b.s + b.n) / 2, lng = (b.w + b.e) / 2;
    const r = Math.round(Math.min(50_000, Math.max(200, ((b.n - b.s) * 111_000) / 2)));
    return { lat, lng, radius: r };
  }
  async function search() {
    if (!enabled) return;
    if (!ids.length) return setMsg({ kind: "warn", text: "Choisis au moins une niche." });
    const c = center();
    if (!c) return setMsg({ kind: "warn", text: where === "zone" ? "Choisis une ville (une zone avec un point connu), ou la carte visible." : "La carte n'est pas encore chargée." });
    if (ids.length > left) return setMsg({ kind: "bad", text: `Plafond du mois presque atteint : ${left} appel(s) restant(s) pour ${ids.length} niche(s). Retire des niches ou augmente le plafond dans Réglages.` });
    setBusy(true); setMsg({ kind: "", text: `Recherche sur ${label} (${ids.length} appel(s) au plus)…` }); setSelected(null);
    try {
      const r = await postJson<Res>("/api/sources/places", { action: "search", provider, nicheIds: ids, lat: c.lat, lng: c.lng, radius: c.radius, limit });
      setRows(r.rows); setUsed(r.used);
      setLbl(`${label} ${niches.filter((n) => ids.includes(n.id)).map((n) => n.label).join(", ")} · ${where === "zone" ? zone.label : "zone de la carte"}`);
      setMsg({ kind: "", text: `${r.rows.length} lieu(x) · ${r.calls} appel(s) facturé(s)${r.cached ? `, ${r.cached} depuis le cache` : ""} · ${r.used.toLocaleString("fr-FR")} / ${r.cap.toLocaleString("fr-FR")} ce mois-ci.${r.skipped.length ? ` Sans terme de recherche : ${r.skipped.join(", ")}.` : ""}` });
    } catch (e) { setMsg({ kind: "bad", text: (e as Error).message }); }
    setBusy(false);
  }

  if (!enabled) return null;
  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="card stack" style={{ gap: 18 }}>
        <Step n={1} title="Où">
          <div className="tabs sub" style={{ margin: 0 }} role="group" aria-label="Zone">
            <button type="button" className={where === "zone" ? "on" : ""} aria-pressed={where === "zone"} onClick={() => setWhere("zone")}>Autour d'une ville</button>
            <button type="button" className={where === "carte" ? "on" : ""} aria-pressed={where === "carte"} onClick={() => setWhere("carte")}>Zone visible de la carte</button>
          </div>
          {where === "zone" && <>
            <ZonePicker value={zone} onChange={setZone} entidades={entidades} favoris={favoris} />
            <label className="f" style={{ maxWidth: 420 }}>Rayon : {radius.toLocaleString("fr-FR")} m<input type="range" min={500} max={20000} step={500} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /></label>
            {zone.lat == null && <span className="small warn-text">Choisis une ville (localidad) pour avoir un point de départ, ou utilise la carte.</span>}
          </>}
        </Step>
        <Step n={2} title="Quoi" hint="une requête par niche">
          {niches.length ? <NicheChips niches={niches} value={ids} onChange={setIds} clearLabel="Tout décocher" />
            : <span className="small muted">Aucune niche n'a de terme de recherche pour {label} : ajoute-en dans la <Link href="/niches">page Niches</Link> (onglet {label}).</span>}
        </Step>
        <Step n={3} title="Options">
          <details><summary className="small muted">Options avancées : nombre de résultats par niche</summary>
            <label className="f" style={{ maxWidth: 260, marginTop: 8 }}>Résultats par niche (max)<select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <p className="tiny muted" style={{ margin: "6px 0 0" }}>Chaque niche = 1 appel, quel que soit le nombre de résultats (plafonné par l'API : Google 20, Foursquare 50, HERE et TomTom 100).</p>
          </details>
        </Step>
        <div className="stack" style={{ gap: 8 }}>
          <p className="step-t"><span className="step-n">4</span>Chercher</p>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy || !ids.length || !left} onClick={search}>{busy ? "Recherche…" : `Chercher sur ${label}`}</button>
            <span className="small muted">{ids.length} appel(s) · reste {left.toLocaleString("fr-FR")} / {cap.toLocaleString("fr-FR")} ce mois-ci</span>
          </div>
          {msg && <p className={msg.kind === "bad" ? "banner bad" : msg.kind === "warn" ? "banner warn" : "small muted"} style={{ margin: 0 }} role="status">{msg.text}</p>}
        </div>
      </div>
      <DenueMap tiles={tiles} rows={rows.map((r) => ({ clee: r.sourceId, nom: r.nom, activite: r.categorie, lat: r.lat, lng: r.lng, existing: r.existing }))}
        point={null} rayon={0} picking={false} onPick={() => {}} selected={selected} attribution={attribution}
        onSelect={(c) => { setSelected(c); document.getElementById("r-" + c)?.scrollIntoView({ block: "nearest" }); }}
        onBounds={(b) => { bounds.current = b; }} />
      {rows.length > 0 && <SourceResults key={lbl + rows.length} rows={rows} setRows={setRows} label={lbl} selected={selected} onSelect={setSelected} niches={niches}
        zone={{ ville: where === "zone" ? zone.label.split(/[,(]/)[0].trim() : "", ...(where === "zone" && zone.ent ? { etat_code: zone.ent } : {}), ...(where === "zone" && zone.mun ? { municipio_code: zone.mun } : {}) }}
        restricted={restricted} attribution={attribution} />}
    </section>
  );
}
