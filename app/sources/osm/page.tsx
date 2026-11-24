import OsmPanel from "@/components/sources/OsmPanel";
import SourceHead from "@/components/SourceHead";
import { osmPresets, OSM_CATEGORIES } from "@/lib/category-map";
import { osmInstances, hostOf } from "@/lib/osm";
import { nicheList } from "@/lib/niches";
import { mainTowns } from "@/lib/geo-qroo";
import { tileConfig } from "@/lib/tiles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "OpenStreetMap · Bedolt CRM" };

export default async function OsmSource() {
  await requireSession("redirect");
  const presets = osmPresets().map((p) => ({ id: p.id, label: p.niche, color: p.color, icon: p.icon, tags: p.tags }));
  return (
    <>
      <SourceHead title="OpenStreetMap" lead="Carte collaborative ; peu de commerces au Mexique, utile en complément de DENUE et Overture."
        help={<><p>Recherche faite par le serveur sur les serveurs publics Overpass ({osmInstances().map(hostOf).join(", ")}), une requête à la fois, gardée 24 h. S'ils sont saturés, le CRM réessaie automatiquement sur le suivant (ordre réglable dans Réglages › Sources & clés). Une grande zone (jusqu'à ~130 km) est découpée en petites parties.</p>
          <p>Les tags OpenStreetMap de chaque niche se règlent dans la page Niches. Données © OpenStreetMap contributors, licence ODbL.</p></>} />
      <OsmPanel presets={presets} categories={[...new Set([...OSM_CATEGORIES, ...presets.flatMap((p) => p.tags)])]} towns={mainTowns()} tiles={tileConfig()} niches={nicheList(true)} />
    </>
  );
}
