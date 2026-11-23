import { Suspense } from "react";
import { distinct } from "@/lib/crm";
import { db } from "@/lib/db";
import MapView from "@/components/MapView";
import { requireSession } from "@/lib/session";
import { tileConfig } from "@/lib/tiles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Carte · Bedolt CRM" };

// Carte des prospects : points chargés côté client par /api/carte/points (filtres de l'URL), détails au clic.
export default async function Carte() {
  await requireSession("redirect");
  const lots = db.prepare("SELECT id, file_name FROM import_batches ORDER BY id DESC LIMIT 30").all() as { id: number; file_name: string }[];
  const options = {
    niches: distinct("niche"), zones: distinct("zone"), offres: distinct("offre"), villes: distinct("ville"),
    webs: distinct("presence_web"), lots, sources: distinct("source"),
  };
  return <Suspense><MapView options={options} tiles={tileConfig()} /></Suspense>;
}
