"use client";
// Leaflet + Leaflet.markercluster, installés via npm et servis par l'application (aucun CDN).
// Chargés à la demande, côté navigateur uniquement (Leaflet manipule window).
import type * as Leaflet from "leaflet";

export type L = typeof Leaflet;
let p: Promise<L> | null = null;
export function loadLeaflet(): Promise<L> {
  return (p ??= (async () => {
    const L = ((await import("leaflet")) as unknown as { default: L }).default;
    (window as unknown as { L: L }).L = L;          // markercluster s'accroche au L global
    await import("leaflet.markercluster");
    return L;
  })());
}

import type { TileConfig } from "@/lib/tiles";
// Fond de carte choisi côté serveur (lib/tiles.ts, MAP_TILES) : attribution OpenStreetMap (et CARTO) obligatoire.
export function addTiles(L: L, map: Leaflet.Map, t: TileConfig) {
  L.tileLayer(t.url, { attribution: t.attribution, subdomains: t.subdomains || "abc", maxZoom: t.maxZoom, minZoom: 6, className: t.darken ? "tiles-dark" : "" }).addTo(map);
  map.setMaxZoom(t.maxZoom);
}
