"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type * as Leaflet from "leaflet";
import { loadLeaflet, addTiles } from "./leaflet-load";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import { DEFAULT_BOUNDS, parseCoords } from "@/lib/geo";
import type { TileConfig } from "@/lib/tiles";

// Correction manuelle de la position : coller des coordonnées / un lien Google Maps, ou déplacer le point.
// Enregistrée en geo_source = manuel : le géocodage automatique ne l'écrase jamais.
export default function GeoEditor({ id, lat, lng, precisionText, source, manual, statutIndex, tiles }: {
  tiles: TileConfig; id: number; lat: number | null; lng: number | null; precisionText: string; source: string; manual: boolean; statutIndex: number;
}) {
  const router = useRouter();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const [text, setText] = useState("");
  const [moved, setMoved] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    loadLeaflet().then((L) => {
      if (dead || !el.current || mapRef.current) return;
      const map = L.map(el.current, { zoomControl: true, attributionControl: true });
      addTiles(L, map, tiles);
      const icon = L.divIcon({ className: `pin s${statutIndex}`, iconSize: [22, 22], iconAnchor: [11, 11] });
      const place = (ll: Leaflet.LatLngExpression) => {
        if (markerRef.current) markerRef.current.setLatLng(ll);
        else {
          markerRef.current = L.marker(ll, { draggable: true, icon, autoPan: true }).addTo(map);
          markerRef.current.on("dragend", () => { const p = markerRef.current!.getLatLng(); setMoved({ lat: p.lat, lng: p.lng }); });
        }
      };
      if (lat != null && lng != null) { map.setView([lat, lng], 16); place([lat, lng]); }
      else map.fitBounds(DEFAULT_BOUNDS);
      // Toucher la carte place le point à cet endroit (fiche sans position ou correction rapide).
      map.on("click", (e) => { place(e.latlng); setMoved({ lat: e.latlng.lat, lng: e.latlng.lng }); });
      mapRef.current = map;
    }).catch(toastError);
    return () => { dead = true; mapRef.current?.remove(); mapRef.current = null; markerRef.current = null; };
  }, [open, lat, lng, statutIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(body: object, msg?: string) {
    setBusy(true);
    try {
      const r = await postJson<{ message: string }>("/api/geo/set", { id, ...body });
      toast(msg ?? r.message); setText(""); setMoved(null); router.refresh();
    } catch (e) { toastError(e); }
    setBusy(false);
  }
  const parsed = text.trim() ? parseCoords(text) : null;

  return (
    <section className="card stack" style={{ marginTop: 10 }}>
      <div className="row spread">
        <b>Position</b>
        <span className={"small " + (lat == null ? "warn-text" : "muted")}>{precisionText}{lat != null && source !== "—" ? ` · ${source}` : ""}</span>
      </div>
      {!open ? (
        <button type="button" className="btn" onClick={() => setOpen(true)}>{lat == null ? "Placer sur la carte" : "Voir / corriger la position"}</button>
      ) : (
        <>
          <div ref={el} className="minimap" role="application" aria-label="Mini-carte : déplace le point pour corriger la position" />
          <p className="tiny muted" style={{ margin: 0 }}>Déplace le point (ou touche la carte), puis enregistre.</p>
          {moved && <button type="button" className="btn primary" disabled={busy} onClick={() => save(moved, "Position enregistrée (manuelle).")}>Enregistrer cette position</button>}
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input value={text} maxLength={3000} onChange={(e) => setText(e.target.value)} placeholder="21.1619, -86.8515 ou lien Google Maps" aria-label="Coordonnées ou lien Google Maps" style={{ flex: 1 }} />
            <button type="button" className="btn" disabled={busy || !text.trim()} onClick={() => save({ text })}>Enregistrer</button>
          </div>
          {text.trim() && <span className={"tiny " + (parsed ? "muted" : "warn-text")}>{parsed ? `Coordonnées lues : ${parsed.lat}, ${parsed.lng}` : "Aucune coordonnée reconnue (les liens courts maps.app.goo.gl n'en contiennent pas)."}</span>}
          {manual && <button type="button" className="btn ghost" disabled={busy} onClick={() => save({ reset: true })}>Effacer et revenir au géocodage automatique</button>}
        </>
      )}
    </section>
  );
}
