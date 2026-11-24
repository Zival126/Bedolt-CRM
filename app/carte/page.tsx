import { Suspense } from "react";
import { filterOptions } from "@/lib/filter-options";
import { nicheList } from "@/lib/niches";
import { mapColorMode } from "@/lib/settings";
import MapView from "@/components/MapView";
import { requireSession } from "@/lib/session";
import { tileConfig } from "@/lib/tiles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Carte · Bedolt CRM" };

// Carte des prospects : points chargés côté client par /api/carte/points (filtres de l'URL), détails au clic.
export default async function Carte() {
  await requireSession("redirect");
  return <Suspense><MapView options={filterOptions()} niches={nicheList(true)} colorMode={mapColorMode()} tiles={tileConfig()} /></Suspense>;
}
