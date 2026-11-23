"use client";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { loadLeaflet, addTiles, type L as LT } from "../leaflet-load";
import { toastError } from "../Toast";
import { STATUTS } from "@/lib/constants";
import { DEFAULT_BOUNDS } from "@/lib/geo";
import type { TileConfig } from "@/lib/tiles";
import type { Row } from "./types";

const STAT = STATUTS.map((s) => s.key) as string[];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Résultats DENUE sur la carte : nouveau = blanc, déjà dans le CRM = couleur de son statut.
// En mode « autour d'un point », un clic sur la carte choisit le centre (cercle = rayon).
export default function DenueMap({ tiles, rows, point, rayon, picking, onPick, onSelect, selected }: {
  tiles: TileConfig; rows: Row[]; point: { lat: number; lng: number } | null; rayon: number; picking: boolean;
  onPick: (p: { lat: number; lng: number }) => void; onSelect: (clee: string) => void; selected: string | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const LRef = useRef<LT | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const cluster = useRef<Leaflet.MarkerClusterGroup | null>(null);
  const circle = useRef<Leaflet.LayerGroup | null>(null);
  const sel = useRef<Leaflet.Marker | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const pickRef = useRef({ picking, onPick, onSelect });
  pickRef.current = { picking, onPick, onSelect };
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    loadLeaflet().then((L) => {
      if (dead || !el.current || map.current) return;
      LRef.current = L;
      const m = L.map(el.current, { zoomControl: true, attributionControl: true });
      m.fitBounds(DEFAULT_BOUNDS);
      addTiles(L, m, tiles);
      const c = L.markerClusterGroup({
        chunkedLoading: true, showCoverageOnHover: false, maxClusterRadius: 44, disableClusteringAtZoom: 18,
        iconCreateFunction: (g) => { const n = g.getChildCount(), s = n < 10 ? 30 : n < 100 ? 36 : 44; return L.divIcon({ html: `<span>${n}</span>`, className: "mcl", iconSize: [s, s] }); },
      });
      m.addLayer(c);
      m.on("click", (e) => { if (pickRef.current.picking) pickRef.current.onPick({ lat: e.latlng.lat, lng: e.latlng.lng }); });
      map.current = m; cluster.current = c;
      setReady(true);
    }).catch(toastError);
    return () => { dead = true; map.current?.remove(); map.current = null; cluster.current = null; markers.current.clear(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Points des résultats
  useEffect(() => {
    const L = LRef.current, c = cluster.current, m = map.current;
    if (!ready || !L || !c || !m) return;
    c.clearLayers(); markers.current.clear();
    const icons = new Map<string, Leaflet.DivIcon>();
    const icon = (cls: string) => icons.get(cls) ?? (icons.set(cls, L.divIcon({ className: cls, iconSize: [14, 14], iconAnchor: [7, 7] })), icons.get(cls)!);
    const layers: Leaflet.Marker[] = [];
    for (const r of rows) {
      if (r.lat == null || r.lng == null) continue;
      const si = r.existing ? Math.max(0, STAT.indexOf(r.existing.statut === "pas_interesse" ? "perdu" : r.existing.statut)) : -1;
      const mk = L.marker([r.lat, r.lng], { icon: icon(si < 0 ? "pin new" : `pin s${si}`), keyboard: false, title: r.nom });
      mk.bindTooltip(`<b>${esc(r.nom)}</b><br>${esc(r.activite)}${r.existing ? "<br>déjà dans le CRM" : ""}`, { direction: "top", offset: [0, -6] });
      mk.on("click", (e) => { L.DomEvent.stopPropagation(e); pickRef.current.onSelect(r.clee); });
      markers.current.set(r.clee, mk);
      layers.push(mk);
    }
    c.addLayers(layers);
    if (layers.length && !pickRef.current.picking) {
      const b = L.latLngBounds(layers.map((x) => x.getLatLng()));
      m.fitBounds(b.pad(0.1), { maxZoom: 16 });
    }
  }, [rows, ready]);

  // Point et rayon de recherche
  useEffect(() => {
    const L = LRef.current, m = map.current;
    if (!ready || !L || !m) return;
    circle.current?.remove(); circle.current = null;
    if (!point) return;
    circle.current = L.layerGroup([
      L.circle([point.lat, point.lng], { radius: rayon, color: "#7c8cff", weight: 1.5, fillOpacity: 0.06, interactive: false }),
      L.circleMarker([point.lat, point.lng], { radius: 6, color: "#fff", weight: 2, fillColor: "#7c8cff", fillOpacity: 1, interactive: false }),
    ]).addTo(m);
    if (picking) m.fitBounds(L.latLng(point.lat, point.lng).toBounds(rayon * 2.4), { maxZoom: 17 });
  }, [point?.lat, point?.lng, rayon, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Établissement sélectionné dans la liste : anneau + centrage
  useEffect(() => {
    const L = LRef.current, m = map.current;
    sel.current?.remove(); sel.current = null;
    if (!ready || !L || !m || !selected) return;
    const mk = markers.current.get(selected);
    if (!mk) return;
    sel.current = L.marker(mk.getLatLng(), { icon: L.divIcon({ className: "pin-sel", iconSize: [24, 24] }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(m);
    m.setView(mk.getLatLng(), Math.max(m.getZoom(), 16));
  }, [selected, ready]);

  return (
    <div className="denue-map-wrap">
      <div ref={el} className="denue-map" role="application" aria-label="Carte des résultats DENUE" />
      {picking && <div className="denue-map-hint">Touche la carte pour choisir le centre de la recherche</div>}
      <div className="denue-legend tiny"><span><i className="pin new" /> nouveau</span>{STATUTS.map((s, i) => <span key={s.key}><i className={`pin s${i}`} /> {s.label}</span>)}</div>
    </div>
  );
}
