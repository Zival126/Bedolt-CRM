import Link from "next/link";
import ImportWizard from "@/components/ImportWizard";
import ImportBatches from "@/components/ImportBatches";
import DenueSearch, { type DenueInit } from "@/components/DenueSearch";
import OsmPanel from "@/components/sources/OsmPanel";
import OverturePanel from "@/components/sources/OverturePanel";
import EnrichCard from "@/components/sources/EnrichCard";
import { importBatches } from "@/lib/crm";
import { denueToken } from "@/lib/settings";
import { municipiosWithSeat, localidades, mainTowns } from "@/lib/geo-qroo";
import { niches } from "@/lib/niches";
import { scianTitle, catalog } from "@/lib/scian";
import { savedSearches } from "@/lib/denue-watch";
import { osmPresets, OSM_CATEGORIES } from "@/lib/category-map";
import { overtureMeta, overtureCount, overtureCategories } from "@/lib/overture";
import { tileConfig } from "@/lib/tiles";
import { requireSession } from "@/lib/session";
import type { SP } from "@/lib/filters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sources · Bedolt CRM" };

const TABS = [["excel", "Import Excel"], ["denue", "DENUE"], ["osm", "OpenStreetMap"], ["overture", "Overture"]] as const;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Sources de leads : un onglet par source ; toutes passent par le même dédoublonnage / la même fusion (lib/sources.ts).
export default async function Sources({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession("redirect");
  const sp = await searchParams;
  const src = TABS.some(([k]) => k === one(sp.src)) ? one(sp.src) : "denue";
  const geo = municipiosWithSeat();
  return (
    <>
      <h1>Sources</h1>
      <nav className="tabs" aria-label="Sources">
        {TABS.map(([k, l]) => <Link key={k} href={`/sources?src=${k}`} className={src === k ? "on" : ""}>{l}</Link>)}
      </nav>
      <EnrichCard />
      <div style={{ height: 12 }} />
      {src === "excel" && <><ImportWizard /><h2>Imports récents</h2><ImportBatches batches={importBatches()} /></>}
      {src === "denue" && <DenuePanel sp={sp} municipios={geo.municipios} />}
      {src === "osm" && <OsmPanel presets={osmPresets()} categories={OSM_CATEGORIES.map(([c]) => c)} towns={mainTowns()} tiles={tileConfig()} />}
      {src === "overture" && <OverturePanel meta={overtureMeta()} count={overtureCount()} categories={overtureCategories()} niches={niches().map((n) => n.label)}
        municipios={geo.municipios} tiles={tileConfig()} />}
    </>
  );
}

function DenuePanel({ sp, municipios }: { sp: SP; municipios: { code: string; nom: string; seat: string }[] }) {
  const ns = niches().map((n) => ({ ...n, titles: n.codes.map((c) => scianTitle(c)) }));
  const saved = savedSearches();
  const codes = new Set([...ns.flatMap((n) => n.codes), ...saved.flatMap((s) => s.params.codes), ...one(sp.codes).split(",")]);
  const titles = Object.fromEntries([...codes].filter((c) => /^\d{2,6}$/.test(c)).map((c) => [c, scianTitle(c)]));
  const lat = Number(one(sp.lat)), lng = Number(one(sp.lng));
  const init: DenueInit = {
    tab: one(sp.tab), mode: one(sp.mode) === "point" ? "point" : one(sp.mode) === "nom" ? "nom" : undefined,
    lat: Number.isFinite(lat) && one(sp.lat) ? lat : undefined, lng: Number.isFinite(lng) && one(sp.lng) ? lng : undefined,
    codes: one(sp.codes).split(",").filter((c) => /^\d{2,6}$/.test(c)).slice(0, 30),
    municipio: /^\d{3}$/.test(one(sp.municipio)) ? one(sp.municipio) : undefined, estrato: /^\d$/.test(one(sp.estrato)) ? one(sp.estrato) : undefined,
    saved: Number(one(sp.saved)) || undefined, news: one(sp.news) === "1",
  };
  return (
    <>
      {!denueToken() && <div className="banner bad" style={{ marginBottom: 12 }}>Token DENUE non configuré — <Link href="/reglages#denue">Réglages &gt; DENUE</Link>.</div>}
      <DenueSearch municipios={municipios} localidades={localidades().map(({ m, c, n, p }) => ({ m, c, n, p }))} niches={ns} saved={saved}
        tiles={tileConfig()} init={init} titles={titles} />
      <p className="tiny muted" style={{ marginTop: 24 }}>Sources : API DENUE (INEGI), {catalog()._source.split(" — ")[0]} (catalogue du {catalog()._date}), Catálogo Único de Claves Geoestadísticas. Le token reste sur le serveur.</p>
    </>
  );
}
