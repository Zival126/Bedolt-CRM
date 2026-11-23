"use client";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type * as Leaflet from "leaflet";
import { loadLeaflet, addTiles, type L as LT } from "./leaflet-load";
import { getJson, postJson } from "./client-api";
import { toast, toastError, UNDO_EVENT } from "./Toast";
import ResultPanel, { type PanelItem } from "./ResultPanel";
import { OffreBadge, Stars, StatusBadge } from "./Badges";
import { isTouch } from "./wa-pending";
import { STATUTS, FICHES } from "@/lib/constants";
import { DEFAULT_BOUNDS } from "@/lib/geo";
import type { TileConfig } from "@/lib/tiles";

// Ligne renvoyée par /api/carte/points : [id, lat, lng, n° statut, n° précision, nom, niche, offre]
type Pt = [number, number, number, number, number, string, string, string];
type PointsRes = { statuts: string[]; precisions: string[]; points: Pt[]; total: number; missing: number; truncated: boolean };
type Detail = {
  id: number; nom: string; niche: string; zone: string; ville: string; offre: string; note: number | null; avis: number | null;
  statut: string; motif: string; angle: string; web: string; lat: number | null; lng: number | null; precision: string; exact: boolean;
  precisionText: string; source: string; tel: string; telLabel: string; maps: string; directions: string;
  stage: string; stageLabel: string; info: string; panel: PanelItem;
};
type GeoStatus = { total: number; done: number; pending: number; located: number; failed: number; missing: number; enabled: boolean; pausedUntil: number | null; lastError: string };
export type MapOptions = { niches: string[]; zones: string[]; offres: string[]; villes: string[]; webs: string[]; lots: { id: number; file_name: string }[] };

const STAT_KEYS = STATUTS.map((s) => s.key) as string[];
const VIEW_KEY = "bedolt-carte-view";
const FILTER_KEYS = ["q", "statut", "niche", "zone", "offre", "ville", "fiche", "web", "note_min", "avis_min", "lot", "file"] as const;
const fmtN = (n: number) => n.toLocaleString("fr-FR");

/** Filtres de l'URL → liens « Voir en liste » (Commerces) et « Mode focus ». */
function linksFor(sp: URLSearchParams) {
  const list = new URLSearchParams({ vue: "toutes" });
  for (const k of FILTER_KEYS) { const v = sp.get(k); if (v) list.set(k, v); }
  const st = sp.get("statut");
  if (!st) list.set("statut", "actifs"); else if (st === "tous") list.delete("statut");
  const focus = new URLSearchParams({ carte: "1" });
  for (const k of FILTER_KEYS) { const v = sp.get(k); if (v) focus.set(k, v); }
  return { list: "/commerces?" + list, focus: "/focus?" + focus };
}

export default function MapView({ options, tiles }: { options: MapOptions; tiles: TileConfig }) {
  const router = useRouter();
  const sp = useSearchParams();
  const query = sp.toString();
  const el = useRef<HTMLDivElement>(null);
  const LRef = useRef<LT | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const clusterRef = useRef<Leaflet.MarkerClusterGroup | null>(null);
  const selRef = useRef<Leaflet.Marker | null>(null);
  const meRef = useRef<Leaflet.LayerGroup | null>(null);
  const markers = useRef(new Map<number, { m: Leaflet.Marker; pt: Pt }>());
  const icons = useRef(new Map<string, Leaflet.DivIcon>());
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<{ shown: number; total: number; missing: number; truncated: boolean } | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [geo, setGeo] = useState<GeoStatus | null>(null);
  const [reload, setReload] = useState(0);

  const iconFor = useCallback((si: number, pi: number) => {
    const exact = pi <= 1, key = `${si}-${exact}`;
    let ic = icons.current.get(key);
    if (!ic) {
      const s = exact ? 14 : 16;
      ic = LRef.current!.divIcon({ className: `pin s${si}${exact ? "" : " approx"}`, iconSize: [s, s], iconAnchor: [s / 2, s / 2], html: "" });
      icons.current.set(key, ic);
    }
    return ic;
  }, []);

  // --- Carte (une seule fois) ---
  useEffect(() => {
    let dead = false;
    loadLeaflet().then((L) => {
      if (dead || !el.current || mapRef.current) return;
      LRef.current = L;
      const map = L.map(el.current, { zoomControl: false, attributionControl: true, worldCopyJump: false });
      let restored = false;
      try {
        const v = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "null") as { lat: number; lng: number; z: number } | null;
        if (v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Number.isFinite(v.z)) { map.setView([v.lat, v.lng], v.z); restored = true; }
      } catch { /* stockage indisponible */ }
      if (!restored) map.fitBounds(DEFAULT_BOUNDS);
      addTiles(L, map, tiles);
      if (!isTouch()) L.control.zoom({ position: "bottomright" }).addTo(map);
      const cluster = L.markerClusterGroup({
        chunkedLoading: true, showCoverageOnHover: false, maxClusterRadius: 48, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 18,
        iconCreateFunction: (c) => {
          const n = c.getChildCount(), s = n < 10 ? 32 : n < 100 ? 38 : n < 1000 ? 46 : 54;
          return L.divIcon({ html: `<span>${n >= 1000 ? (n / 1000).toFixed(1).replace(".", ",") + " k" : n}</span>`, className: "mcl", iconSize: [s, s] });
        },
      });
      map.addLayer(cluster);
      map.on("moveend", () => {
        const c = map.getCenter();
        try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, z: map.getZoom() })); } catch { /* */ }
      });
      map.on("click", () => setSel(null));
      mapRef.current = map; clusterRef.current = cluster;
      setReady(true);
    }).catch(toastError);
    return () => { dead = true; mapRef.current?.remove(); mapRef.current = null; clusterRef.current = null; icons.current.clear(); markers.current.clear(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Points pour les filtres de l'URL ---
  useEffect(() => {
    if (!ready) return;
    let stale = false;
    setLoading(true);
    getJson<PointsRes>("/api/carte/points?" + query).then((r) => {
      if (stale || !clusterRef.current || !LRef.current) return;
      const L = LRef.current, cluster = clusterRef.current;
      cluster.clearLayers();
      markers.current.clear();
      const layers: Leaflet.Marker[] = [];
      for (const pt of r.points) {
        const m = L.marker([pt[1], pt[2]], { icon: iconFor(pt[3], pt[4]), keyboard: false, title: pt[5] });
        m.on("click", (e) => { L.DomEvent.stopPropagation(e); setSel(pt[0]); });
        markers.current.set(pt[0], { m, pt });
        layers.push(m);
      }
      cluster.addLayers(layers);
      setCounts({ shown: r.points.length, total: r.total, missing: r.missing, truncated: r.truncated });
    }).catch(toastError).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [ready, query, reload, iconFor]);

  // --- Point sélectionné : anneau + détails ---
  const selId = useRef<number | null>(null);
  async function loadDetail(id: number) {
    try {
      const d = await getJson<Detail>("/api/carte/fiche?id=" + id);
      recolor(id, d.statut);
      if (selId.current === id) setDetail(d);
    } catch (e) { toastError(e); }
  }

  useEffect(() => {
    selId.current = sel;
    const L = LRef.current, map = mapRef.current;
    selRef.current?.remove(); selRef.current = null;
    if (sel == null) { setDetail(null); return; }
    const e = markers.current.get(sel);
    if (L && map && e) selRef.current = L.marker(e.m.getLatLng(), { icon: L.divIcon({ className: "pin-sel", iconSize: [26, 26] }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    setDetail(null);
    loadDetail(sel);
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Couleur du point mise à jour sans recharger la carte. */
  function recolor(id: number, statut: string) {
    const e = markers.current.get(id);
    const si = Math.max(0, STAT_KEYS.indexOf(statut === "pas_interesse" ? "perdu" : statut));
    if (!e || e.pt[3] === si) return;
    e.pt[3] = si;
    e.m.setIcon(iconFor(si, e.pt[4]));
  }

  // Annuler (toast) : on relit la fiche concernée pour remettre sa couleur.
  useEffect(() => {
    const on = (ev: Event) => {
      const id = (ev as CustomEvent<{ businessId?: number }>).detail?.businessId;
      if (id == null || !markers.current.has(id)) return;
      getJson<Detail>("/api/carte/fiche?id=" + id).then((d) => { recolor(id, d.statut); setDetail((cur) => (cur?.id === id ? d : cur)); }).catch(() => {});
    };
    window.addEventListener(UNDO_EVENT, on);
    return () => window.removeEventListener(UNDO_EVENT, on);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Géocodage : progression ---
  const pollGeo = useCallback(async () => {
    try { const s = await getJson<GeoStatus>("/api/geo/status"); setGeo(s); return s; } catch { return null; }
  }, []);
  useEffect(() => { pollGeo(); }, [pollGeo]);
  useEffect(() => {
    if (!geo || geo.pending <= 0) return;
    let n = 0;
    const t = setInterval(async () => {
      const s = await pollGeo();
      if (++n % 8 === 0 || (s && s.pending === 0)) setReload((x) => x + 1);   // les points apparaissent au fil de l'eau
    }, 2000);
    return () => clearInterval(t);
  }, [geo?.pending ? 1 : 0, pollGeo]); // eslint-disable-line react-hooks/exhaustive-deps
  async function startGeo() {
    try {
      const r = await postJson<{ added: number; status: GeoStatus }>("/api/geo/enqueue", { scope: "missing" });
      setGeo(r.status);
      toast(r.added ? `${fmtN(r.added)} fiche(s) ajoutée(s) au géocodage.` : "Aucune nouvelle fiche à géolocaliser.");
    } catch (e) { toastError(e); }
  }

  // --- Ma position ---
  function locateMe() {
    if (!navigator.geolocation) return toast("Géolocalisation indisponible sur cet appareil.", { kind: "err" });
    navigator.geolocation.getCurrentPosition((p) => {
      const L = LRef.current, map = mapRef.current;
      if (!L || !map) return;
      const ll: [number, number] = [p.coords.latitude, p.coords.longitude];
      meRef.current?.remove();
      meRef.current = L.layerGroup([
        L.circle(ll, { radius: Math.min(p.coords.accuracy, 2000), color: "#4f9dff", weight: 1, fillOpacity: 0.08, interactive: false }),
        L.circleMarker(ll, { radius: 7, color: "#fff", weight: 2, fillColor: "#4f9dff", fillOpacity: 1, interactive: false }),
      ]).addTo(map);
      map.flyTo(ll, Math.max(map.getZoom(), 15));
    }, (err) => toast(err.code === 1 ? "Position refusée : autorise la localisation pour ce site." : "Position introuvable.", { kind: "err" }),
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
  }

  function applyFilters(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = new URLSearchParams();
    for (const [k, v] of new FormData(e.currentTarget)) { const s = String(v).trim(); if (s) p.set(k, s); }
    setFiltersOpen(false); setSel(null);
    router.replace("/carte" + (p.size ? "?" + p : ""), { scroll: false });
  }

  const links = linksFor(sp);
  const active = FILTER_KEYS.filter((k) => sp.get(k) && !(k === "statut" && sp.get(k) === "actifs")).length;
  const running = !!geo && geo.pending > 0;

  return (
    <div className="carte">
      <aside className={"carte-side" + (filtersOpen ? " open" : "")} aria-label="Filtres de la carte">
        <div className="row spread"><h1 style={{ margin: 0, fontSize: 20 }}>Carte</h1>
          <button type="button" className="btn ghost icon only-mob" aria-label="Fermer les filtres" onClick={() => setFiltersOpen(false)}>✕</button></div>
        <form key={query} onSubmit={applyFilters} className="stack" style={{ gap: 8 }}>
          <input name="q" placeholder="Nom ou téléphone" defaultValue={sp.get("q") ?? ""} />
          <select name="statut" defaultValue={sp.get("statut") ?? ""} aria-label="Statut">
            <option value="">Tous sauf Perdu</option><option value="tous">Tous (y compris Perdu)</option>
            {STATUTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <Sel name="niche" label="Niche" values={options.niches} sp={sp} />
          <Sel name="zone" label="Zone" values={options.zones} sp={sp} />
          <Sel name="offre" label="Offre" values={options.offres} sp={sp} />
          <Sel name="ville" label="Ville" values={options.villes} sp={sp} none={false} />
          <Sel name="web" label="Présence web" values={options.webs} sp={sp} />
          <select name="fiche" defaultValue={sp.get("fiche") ?? ""} aria-label="Fiche Google">
            <option value="">Fiche Google : toutes</option>{FICHES.map((s) => <option key={s.key} value={s.key || "none"}>Fiche : {s.key ? s.label : "non renseignée"}</option>)}
          </select>
          <div className="grid g2">
            <input name="note_min" type="number" step="0.1" min={0} max={5} inputMode="decimal" placeholder="Note min." defaultValue={sp.get("note_min") ?? ""} aria-label="Note Google minimale" />
            <input name="avis_min" type="number" step="1" min={0} inputMode="numeric" placeholder="Avis min." defaultValue={sp.get("avis_min") ?? ""} aria-label="Nombre d'avis minimal" />
          </div>
          <select name="lot" defaultValue={sp.get("lot") ?? ""} aria-label="Lot d'import">
            <option value="">Lot d'import : tous</option>{options.lots.map((l) => <option key={l.id} value={l.id}>#{l.id} · {l.file_name}</option>)}
          </select>
          <label className="chk small" style={{ minHeight: 44 }}><input type="checkbox" name="file" value="1" defaultChecked={sp.get("file") === "1"} />Dans la file du jour</label>
          <div className="grid g2"><button className="btn primary">Appliquer</button><Link href="/carte" className="btn" onClick={() => setFiltersOpen(false)}>Réinitialiser</Link></div>
        </form>
        <div className="stack" style={{ gap: 8 }}>
          <Link className="btn wide" href={links.list}>Voir ces fiches en liste</Link>
          <Link className="btn primary-soft wide" href={links.focus}>▶ Lancer le mode focus sur ces fiches</Link>
        </div>
        <div className="card stack geo-card" style={{ gap: 8, padding: 12 }}>
          <b className="small">Positions</b>
          {running ? (
            <>
              <div className="row spread small"><span>Géolocalisation en cours…</span><b>{fmtN(geo!.done)} / {fmtN(geo!.total)}</b></div>
              <div className="bar"><i style={{ width: (geo!.done / Math.max(1, geo!.total)) * 100 + "%" }} /></div>
              <span className="tiny muted">1 requête / seconde (OpenStreetMap) · tu peux quitter la page, ça continue sur le serveur.</span>
              {geo!.pausedUntil ? <span className="tiny warn-text">En pause : {geo!.lastError}</span> : null}
            </>
          ) : (
            <>
              <button type="button" className="btn wide" disabled={!geo?.missing} onClick={startGeo}>Géolocaliser les fiches sans position{geo?.missing ? ` (${fmtN(geo.missing)})` : ""}</button>
              {geo && geo.total > 0 && <span className="tiny muted">Dernier lot : {fmtN(geo.located)} placée(s), {fmtN(geo.failed)} introuvable(s) sur {fmtN(geo.total)}.</span>}
              {geo && !geo.enabled && <span className="tiny warn-text">Géocodage désactivé sur ce serveur (GEOCODER=off).</span>}
            </>
          )}
        </div>
      </aside>
      {filtersOpen && <div className="carte-backdrop only-mob" onClick={() => setFiltersOpen(false)} />}

      <div className="carte-main">
        <div ref={el} className="carte-map" role="application" aria-label="Carte des prospects" />
        <div className="carte-top">
          <button type="button" className="btn pillbtn only-mob" onClick={() => setFiltersOpen(true)}>Filtres{active ? ` (${active})` : ""}</button>
          <div className="pill" aria-live="polite">
            {counts ? <><b>{fmtN(counts.shown)}</b> fiche{counts.shown > 1 ? "s" : ""} sur la carte · {fmtN(counts.missing)} sans position{counts.truncated ? " (limite atteinte)" : ""}</> : "Chargement…"}
            {loading && counts ? " …" : ""}
            {running && <span className="muted"> · géoloc. {fmtN(geo!.done)} / {fmtN(geo!.total)}</span>}
          </div>
          <button type="button" className="btn pillbtn" onClick={locateMe} aria-label="Ma position">◎<span className="hide-xs"> Ma position</span></button>
        </div>
        <details className="legend">
          <summary>Légende</summary>
          <div className="stack" style={{ gap: 4, marginTop: 6 }}>
            {STATUTS.map((s, i) => <span key={s.key} className="row small" style={{ gap: 8, flexWrap: "nowrap" }}><i className={`pin s${i}`} style={{ width: 12, height: 12, display: "inline-block" }} />{s.label}</span>)}
            <span className="row tiny muted" style={{ gap: 8, flexWrap: "nowrap", marginTop: 4 }}><i className="pin s1" style={{ width: 12, height: 12, display: "inline-block" }} />plein : commerce / adresse</span>
            <span className="row tiny muted" style={{ gap: 8, flexWrap: "nowrap" }}><i className="pin s1 approx" style={{ width: 13, height: 13, display: "inline-block" }} />creux : quartier / ville (approx.)</span>
          </div>
        </details>
        {sel != null && (
          <div className="bubble" role="dialog" aria-label={detail?.nom ?? "Fiche"}>
            {!detail ? <div className="small muted">Chargement…</div> : (
              <Bubble d={detail} onClose={() => setSel(null)}
                onResult={(r) => recolor(detail.id, r.statut)}
                onResolved={() => loadDetail(detail.id)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Sel({ name, label, values, sp, none = true }: { name: string; label: string; values: string[]; sp: URLSearchParams; none?: boolean }) {
  return (
    <select name={name} defaultValue={sp.get(name) ?? ""} aria-label={label}>
      <option value="">{label} : toutes</option>
      {none && <option value="none">{label} : non renseignée</option>}
      {values.map((v) => <option key={v} value={v}>{v}</option>)}
    </select>
  );
}

function Bubble({ d, onClose, onResult, onResolved }: { d: Detail; onClose: () => void; onResult: (r: { statut: string }) => void; onResolved: () => void }) {
  const closed = d.stage === "perdu" || d.stage === "paye";
  return (
    <>
      <div className="row spread" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="t">{d.nom}</div>
          <div className="small muted">{[d.niche, d.zone, d.ville].filter(Boolean).join(" · ")}</div>
        </div>
        <button type="button" className="btn ghost icon" aria-label="Fermer" onClick={onClose}>✕</button>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <OffreBadge o={d.offre} /><Stars note={d.note} avis={d.avis} /><StatusBadge s={d.statut} motif={d.motif} />
        {d.web && <span className="badge">Web : {d.web}</span>}
      </div>
      {d.angle && <div className="angle line2" title={d.angle}>{d.angle}</div>}
      <div className={"tiny " + (d.exact ? "muted" : "warn-text")}>📍 {d.precisionText}{d.source !== "—" ? ` · source ${d.source}` : ""}</div>
      {d.info && <div className="tiny muted">{d.stageLabel} · {d.info}</div>}
      <div className="bubble-links">
        {closed && (d.tel ? <a className="btn" href={d.tel}>📞 Appeler</a> : <span className="btn off">Pas de tél.</span>)}
        <Link className="btn" href={`/commerces/${d.id}`}>Ouvrir la fiche</Link>
        <a className="btn" href={d.directions} target="_blank" rel="noreferrer">Itinéraire ↗</a>
      </div>
      {d.stage !== "paye" && <ResultPanel key={`${d.id}-${d.stage}-${d.statut}`} item={d.panel} onResult={onResult} onResolved={onResolved} />}
    </>
  );
}
