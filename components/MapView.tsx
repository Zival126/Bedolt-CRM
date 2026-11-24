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
import { STATUTS } from "@/lib/constants";
import { DEFAULT_BOUNDS } from "@/lib/geo";
import type { TileConfig } from "@/lib/tiles";
import FilterPanel, { type FilterOptions } from "./FilterPanel";
import { NicheBadge, NicheIcon } from "./ui";
import { iconPath, NO_NICHE, type NicheLite } from "@/lib/niche-style";

// Ligne renvoyée par /api/carte/points : [id, lat, lng, n° statut, n° précision, nom, niche, offre, id de niche]
type Pt = [number, number, number, number, number, string, string, string, number];
type PointsRes = { statuts: string[]; precisions: string[]; points: Pt[]; total: number; missing: number; truncated: boolean; facet: Record<number, number> };
type Detail = {
  id: number; nom: string; niche: string; nicheId: number | null; zone: string; ville: string; offre: string; note: number | null; avis: number | null;
  statut: string; motif: string; angle: string; web: string; lat: number | null; lng: number | null; precision: string; exact: boolean;
  precisionText: string; source: string; tel: string; telLabel: string; maps: string; directions: string;
  stage: string; stageLabel: string; info: string; panel: PanelItem;
};
type GeoStatus = { total: number; done: number; pending: number; located: number; failed: number; missing: number; enabled: boolean; pausedUntil: number | null; lastError: string };
const STAT_KEYS = STATUTS.map((s) => s.key) as string[];
const STAT_COLORS = ["#9aa0a9", "#4f9dff", "#a78bfa", "#f59e42", "#3ecf8e", "#c97b7e"];
const VIEW_KEY = "bedolt-carte-view";
const MODE_KEY = "bedolt-carte-couleur";
const FILTER_KEYS = ["q", "statut", "niche", "zone", "offre", "ville", "fiche", "web", "note_min", "avis_min", "lot", "file",
  "email", "site", "tel", "wa", "pos", "source", "dnc", "tag", "etat", "n"] as const;
const CLOSE_ZOOM = 16;   // icône de niche dans le point à partir de ce zoom
const fmtN = (n: number) => n.toLocaleString("fr-FR");

/** Filtres de l'URL → liens « Voir en liste » (Commerces) et « Mode focus ». */
function linksFor(sp: URLSearchParams) {
  const list = new URLSearchParams({ vue: "toutes" });
  for (const k of FILTER_KEYS) { const v = sp.get(k); if (v) list.set(k, v); }
  const st = sp.get("statut");
  if (!st) list.set("statut", "actifs"); else if (st === "tous") list.delete("statut");
  // Carte : « ne pas contacter » masquées par défaut → même chose dans la liste
  const dnc = sp.get("dnc");
  if (!dnc) list.set("dnc", "0"); else if (dnc === "tous") list.delete("dnc");
  const focus = new URLSearchParams({ carte: "1" });
  for (const k of FILTER_KEYS) { const v = sp.get(k); if (v) focus.set(k, v); }
  return { list: "/commerces?" + list, focus: "/focus?" + focus };
}

export default function MapView({ options, niches, colorMode, tiles }: { options: FilterOptions; niches: NicheLite[]; colorMode: "niche" | "statut"; tiles: TileConfig }) {
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
  const [facet, setFacet] = useState<Record<number, number>>({});
  const [mode, setMode] = useState<"niche" | "statut">(colorMode);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [present, setPresent] = useState<Record<number, number>>({});
  const nicheMap = useRef(new Map(niches.map((n) => [n.id, n])));
  const modeRef = useRef(mode); modeRef.current = mode;
  const [legendOpen, setLegendOpen] = useState(false);
  useEffect(() => { if (window.innerWidth >= 900) setLegendOpen(true); }, []);
  const hiddenRef = useRef(hidden); hiddenRef.current = hidden;
  useEffect(() => { try { const m = localStorage.getItem(MODE_KEY); if (m === "niche" || m === "statut") setMode(m); } catch { /* */ } }, []);
  const nOf = (id: number) => nicheMap.current.get(id) ?? NO_NICHE;
  const fitPending = useRef(false);   // pas de vue mémorisée : la carte se cale sur les fiches (même hors Quintana Roo)

  /** Point : couleur = niche (ou statut selon l'option), anneau = statut ; icône de la niche au zoom proche. */
  const iconFor = useCallback((si: number, pi: number, nid: number) => {
    const exact = pi <= 1, byStat = modeRef.current === "statut", key = `${byStat ? "s" : nid}-${si}-${exact}`;
    let ic = icons.current.get(key);
    if (!ic) {
      const n = nOf(nid), c = byStat ? STAT_COLORS[si] : n.color, s = exact ? 16 : 17;
      const html = `<div class="pin2 ${byStat ? "" : "r" + si}${exact ? "" : " approx"}" style="--c:${c}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${byStat ? "" : iconPath(n.icon)}"/></svg></div>`;
      ic = LRef.current!.divIcon({ className: "npin", iconSize: [s, s], iconAnchor: [s / 2, s / 2], html });
      icons.current.set(key, ic);
    }
    return ic;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      fitPending.current = !restored;
      addTiles(L, map, tiles);
      if (!isTouch()) L.control.zoom({ position: "bottomright" }).addTo(map);
      const cluster = L.markerClusterGroup({
        chunkedLoading: true, showCoverageOnHover: false, maxClusterRadius: 48, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 18,
        // Anneau = répartition des niches (ou des statuts) des points du groupe
        iconCreateFunction: (c) => {
          const n = c.getChildCount(), s = n < 10 ? 34 : n < 100 ? 40 : n < 1000 ? 48 : 56;
          const tally = new Map<string, number>();
          for (const m of c.getAllChildMarkers()) { const k = (m.options as { nc?: string; sc?: string })[modeRef.current === "statut" ? "sc" : "nc"] ?? "#94a3b8"; tally.set(k, (tally.get(k) ?? 0) + 1); }
          let acc = 0;
          const stops = [...tally].sort((a, b) => b[1] - a[1]).map(([col, k]) => { const a = acc; acc += (k / n) * 360; return `${col} ${a.toFixed(1)}deg ${acc.toFixed(1)}deg`; }).join(",");
          const label = n >= 1000 ? (n / 1000).toFixed(1).replace(".", ",") + " k" : String(n);
          return L.divIcon({ html: `<div class="mcl2" style="width:${s}px;height:${s}px;background:conic-gradient(${stops})"><span>${label}</span></div>`, className: "npin", iconSize: [s, s] });
        },
      });
      map.addLayer(cluster);
      map.on("moveend", () => {
        const c = map.getCenter();
        try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, z: map.getZoom() })); } catch { /* */ }
      });
      map.on("click", () => setSel(null));
      const zc = () => el.current?.classList.toggle("zclose", map.getZoom() >= CLOSE_ZOOM);
      map.on("zoomend", zc); zc();
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
      const pres: Record<number, number> = {};
      for (const pt of r.points) {
        const m = L.marker([pt[1], pt[2]], { icon: iconFor(pt[3], pt[4], pt[8]), keyboard: false, title: pt[5], ...({ nc: nOf(pt[8]).color, sc: STAT_COLORS[pt[3]] } as object) });
        m.on("click", (e) => { L.DomEvent.stopPropagation(e); setSel(pt[0]); });
        markers.current.set(pt[0], { m, pt });
        pres[pt[8]] = (pres[pt[8]] ?? 0) + 1;
        if (!hiddenRef.current.has(pt[8])) layers.push(m);
      }
      cluster.addLayers(layers);
      setPresent(pres); setFacet(r.facet ?? {});
      if (fitPending.current && layers.length && mapRef.current) {
        fitPending.current = false;
        mapRef.current.fitBounds(L.latLngBounds(layers.map((m) => m.getLatLng())).pad(0.05), { maxZoom: 14 });
      }
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
    (e.m.options as { sc?: string }).sc = STAT_COLORS[si];
    e.m.setIcon(iconFor(si, e.pt[4], e.pt[8]));
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

  /** Niches masquées (légende) et mode de couleur : la carte est redessinée sans recharger les points. */
  const redraw = useCallback(() => {
    const c = clusterRef.current;
    if (!c) return;
    icons.current.clear();
    c.clearLayers();
    const layers: Leaflet.Marker[] = [];
    for (const { m, pt } of markers.current.values()) { m.setIcon(iconFor(pt[3], pt[4], pt[8])); if (!hiddenRef.current.has(pt[8])) layers.push(m); }
    c.addLayers(layers);
  }, [iconFor]);
  useEffect(() => { if (ready) redraw(); }, [mode, hidden, ready, redraw]);
  function setColorMode(m: "niche" | "statut") { setMode(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* */ } }
  const toggleNiche = (id: number) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function pickVisible() {
    const n = counts?.shown ?? 0;
    if (!n) return;
    if (n > 50 && !confirm(`Ajouter les fiches « À contacter » de cette carte à ta journée (500 au plus) ?`)) return;
    try {
      const r = await postJson<{ added: number; already: number; skipped: number }>("/api/day", { action: "pick", query, from: "carte" });
      toast(`${r.added} fiche(s) ajoutée(s) à ta journée${r.already ? ` · ${r.already} déjà dedans` : ""}${r.skipped ? ` · ${r.skipped} ignorée(s) (pas « À contacter » ou sans WhatsApp)` : ""}.`);
    } catch (e) { toastError(e); }
  }

  const links = linksFor(sp);
  const place = sp.get("ville") || (sp.get("etat") ? options.etats.find((x) => x.c === sp.get("etat"))?.n : "") || sp.get("zone") || "";
  const shownNiches = [...niches.filter((n) => present[n.id]), ...(present[0] ? [NO_NICHE] : [])];
  const running = !!geo && geo.pending > 0;

  return (
    <div className="carte">
      <aside className={"carte-side" + (filtersOpen ? " open" : "")} aria-label="Filtres de la carte">
        <div className="row spread" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}><div><h1 style={{ margin: 0, fontSize: 20 }}>Carte</h1><p className="tiny muted" style={{ margin: 0 }}>Tes prospects sur le terrain : couleur = niche, contour = statut.</p></div>
          <button type="button" className="btn ghost icon only-mob" aria-label="Fermer les filtres" onClick={() => setFiltersOpen(false)}>✕</button></div>
        <p className="carte-count" aria-live="polite">{counts ? <><b>{fmtN(counts.shown)}</b> point{counts.shown > 1 ? "s" : ""}{place ? ` · ${place}` : ""}{counts.missing ? ` · ${fmtN(counts.missing)} sans position` : ""}</> : "Chargement…"}</p>
        <FilterPanel mode="map" options={options} niches={niches.filter((n) => facet[n.id] || sp.get("n")?.split(",").includes(String(n.id)))} counts={facet} />
        <div className="stack" style={{ gap: 8 }}>
          <button type="button" className="btn primary wide" disabled={!counts?.shown} onClick={pickVisible}>＋ Ajouter ces fiches à ma journée</button>
          <Link className="btn wide" href={links.focus}>▶ Mode focus sur ces fiches</Link>
          <Link className="btn ghost wide" href={links.list}>Voir ces fiches en liste</Link>
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
          <button type="button" className="btn pillbtn only-mob" onClick={() => setFiltersOpen(true)}>Filtres</button>
          <div className="pill" aria-live="polite">
            {counts ? <><b>{fmtN(counts.shown)}</b> point{counts.shown > 1 ? "s" : ""}{place ? ` · ${place}` : ""}{counts.truncated ? " (limite atteinte)" : ""}</> : "Chargement…"}
            {loading && counts ? " …" : ""}
            {running && <span className="muted"> · géoloc. {fmtN(geo!.done)} / {fmtN(geo!.total)}</span>}
          </div>
          <button type="button" className="btn pillbtn" onClick={locateMe} aria-label="Ma position">◎<span className="hide-xs"> Ma position</span></button>
        </div>
        <details className="legend2" open={legendOpen} onToggle={(e) => setLegendOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>Légende {hidden.size ? <span className="fcount">{hidden.size} masquée{hidden.size > 1 ? "s" : ""}</span> : null}</summary>
          <div className="seg" role="group" aria-label="Couleur des points" style={{ margin: "4px 0 6px" }}>
            <button type="button" className={mode === "niche" ? "on" : ""} aria-pressed={mode === "niche"} onClick={() => setColorMode("niche")}>Couleur = niche</button>
            <button type="button" className={mode === "statut" ? "on" : ""} aria-pressed={mode === "statut"} onClick={() => setColorMode("statut")}>= statut</button>
          </div>
          {mode === "niche" && <>
            <h4>Niches (touche pour masquer)</h4>
            {shownNiches.map((n) => (
              <button key={n.id} type="button" className={"lg-row" + (hidden.has(n.id) ? " off" : "")} aria-pressed={!hidden.has(n.id)} onClick={() => toggleNiche(n.id)}>
                <span className="ndot" style={{ "--n": n.color } as React.CSSProperties} /><NicheIcon icon={n.icon} size={13} /><span style={{ flex: 1 }}>{n.label}</span><span className="muted">{fmtN(present[n.id] ?? 0)}</span>
              </button>))}
            {hidden.size > 0 && <button type="button" className="link tiny" onClick={() => setHidden(new Set())}>Tout afficher</button>}
            <h4>Contour = statut</h4>
            {STATUTS.map((s, i) => <span key={s.key} className="lg-row" style={{ cursor: "default" }}><span className={`lg-ring r${i}`} />{s.label}</span>)}
          </>}
          {mode === "statut" && <>
            <h4>Couleur = statut</h4>
            {STATUTS.map((s, i) => <span key={s.key} className="lg-row" style={{ cursor: "default" }}><span className="ndot" style={{ "--n": STAT_COLORS[i] } as React.CSSProperties} />{s.label}</span>)}
          </>}
          <h4>Précision</h4>
          <span className="lg-row" style={{ cursor: "default" }}><span className="ndot" style={{ "--n": "#c9ccd2" } as React.CSSProperties} />plein : commerce / adresse</span>
          <span className="lg-row" style={{ cursor: "default" }}><span className="ndot" style={{ "--n": "transparent", border: "2px solid #c9ccd2" } as React.CSSProperties} />creux : quartier / ville (approx.)</span>
        </details>
        {sel != null && (
          <div className="bubble" role="dialog" aria-label={detail?.nom ?? "Fiche"}>
            {!detail ? <div className="small muted">Chargement…</div> : (
              <Bubble d={detail} onClose={() => setSel(null)} nicheOf={nOf}
                onResult={(r) => recolor(detail.id, r.statut)}
                onResolved={() => loadDetail(detail.id)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Bubble({ d, onClose, onResult, onResolved, nicheOf }: { d: Detail; onClose: () => void; onResult: (r: { statut: string }) => void; onResolved: () => void; nicheOf: (id: number) => NicheLite }) {
  const closed = d.stage === "perdu" || d.stage === "paye";
  return (
    <>
      <div className="row spread" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="t">{d.nom}</div>
          <div className="row small muted" style={{ gap: 6 }}><NicheBadge n={d.nicheId ? nicheOf(d.nicheId) : null} small />{[d.zone, d.ville].filter(Boolean).join(" · ")}</div>
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
