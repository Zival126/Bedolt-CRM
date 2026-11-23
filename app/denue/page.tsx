import DenueSearch, { type DenueInit } from "@/components/DenueSearch";
import { denueToken } from "@/lib/settings";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { municipiosWithSeat, localidades } from "@/lib/geo-qroo";
import { niches } from "@/lib/niches";
import { scianTitle, catalog } from "@/lib/scian";
import { savedSearches } from "@/lib/denue-watch";
import { tileConfig } from "@/lib/tiles";
import type { SP } from "@/lib/filters";

export const dynamic = "force-dynamic";
export const metadata = { title: "DENUE · Bedolt CRM" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function Denue({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession("redirect");
  const sp = await searchParams;
  const geo = municipiosWithSeat();
  const ns = niches().map((n) => ({ ...n, titles: n.codes.map((c) => scianTitle(c)) }));
  const saved = savedSearches();
  // Titres SCIAN des codes déjà utilisés (niches, recherches enregistrées, URL) : affichage sans requête
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
  const c = catalog();
  return (
    <>
      <h1>DENUE</h1>
      {!denueToken() && <div className="banner bad" style={{ marginBottom: 12 }}>Token DENUE non configuré — <Link href="/reglages#denue">Réglages &gt; DENUE</Link>.</div>}
      <DenueSearch municipios={geo.municipios} localidades={localidades().map(({ m, c, n, p }) => ({ m, c, n, p }))} niches={ns} saved={saved}
        tiles={tileConfig()} init={init} titles={titles} />
      <p className="tiny muted" style={{ marginTop: 24 }}>Sources : API DENUE (INEGI), {c._source.split(" — ")[0]} (catalogue du {c._date}), Catálogo Único de Claves Geoestadísticas. Le token reste sur le serveur.</p>
    </>
  );
}
