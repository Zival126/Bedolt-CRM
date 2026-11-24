import Link from "next/link";
import DenueSearch, { type DenueInit } from "@/components/DenueSearch";
import SourceHead from "@/components/SourceHead";
import { denueToken } from "@/lib/settings";
import { entidades, favoris, zoneLabel, entidad as entOf, municipio as munOf, localidadMx } from "@/lib/geo-mx";
import { niches } from "@/lib/niches";
import { scianTitle, catalog } from "@/lib/scian";
import { savedSearches } from "@/lib/denue-watch";
import { tileConfig } from "@/lib/tiles";
import { requireSession } from "@/lib/session";
import type { SP } from "@/lib/filters";

export const dynamic = "force-dynamic";
export const metadata = { title: "DENUE · Bedolt CRM" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function DenueSource({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession("redirect");
  const sp = await searchParams;
  const ents = entidades().map((e) => ({ code: e.c, nom: e.n }));
  const ns = niches().map((n) => ({ ...n, titles: n.codes.map((c) => scianTitle(c)) }));
  const saved = savedSearches();
  const codes = new Set([...ns.flatMap((n) => n.codes), ...saved.flatMap((s) => s.params.codes), ...one(sp.codes).split(",")]);
  const titles = Object.fromEntries([...codes].filter((c) => /^\d{2,6}$/.test(c)).map((c) => [c, scianTitle(c)]));
  const lat = Number(one(sp.lat)), lng = Number(one(sp.lng));
  const init: DenueInit = {
    tab: one(sp.tab), mode: one(sp.mode) === "point" ? "point" : one(sp.mode) === "nom" ? "nom" : undefined,
    lat: Number.isFinite(lat) && one(sp.lat) ? lat : undefined, lng: Number.isFinite(lng) && one(sp.lng) ? lng : undefined,
    codes: one(sp.codes).split(",").filter((c) => /^\d{2,6}$/.test(c)).slice(0, 30),
    estrato: /^\d$/.test(one(sp.estrato)) ? one(sp.estrato) : undefined,
    saved: Number(one(sp.saved)) || undefined, news: one(sp.news) === "1",
    zone: urlZone(sp),
  };
  const def = { ent: "23", mun: "005", loc: "", label: zoneLabel({ ent: "23", mun: "005" }) };
  return (
    <>
      <SourceHead title="DENUE (INEGI)" lead="Registre officiel des commerces du Mexique, tout le pays : choisis une zone et des niches, puis ajoute les commerces au CRM."
        help={<><p>Données de l'API DENUE (INEGI) et du catalogue {catalog()._source.split(" — ")[0]} (du {catalog()._date}). Le token reste sur le serveur. Les réponses sont gardées 24 h en cache.</p>
          <p>« Enregistrées » : relance une recherche en 1 clic, ou active la veille hebdomadaire (seuls les établissements jamais vus sont signalés). « Marché » : nombre d'établissements DENUE par niche et par municipio, face à tes fiches.</p></>} />
      {!denueToken() && <div className="banner warn" style={{ marginBottom: 12 }}>Le token DENUE n'est pas configuré : la recherche ne peut pas fonctionner. <Link href="/reglages#sources">Le configurer dans Réglages › Sources & clés</Link>.</div>}
      <DenueSearch entidades={ents} favoris={favoris().map((f) => ({ ...f }))} defaultZone={def} niches={ns} saved={saved}
        tiles={tileConfig()} init={init} titles={titles} />
    </>
  );
}

/** Zone passée dans l'URL (?entidad=19&municipio=039&localidad=0001 ; municipio seul = Quintana Roo, anciens liens). */
function urlZone(sp: SP) {
  const ent = one(sp.entidad) || (one(sp.municipio) ? "23" : "");
  const mun = one(sp.municipio), loc = one(sp.localidad);
  if (!/^\d{2}$/.test(ent) || !entOf(ent)) return undefined;
  const m = /^\d{3}$/.test(mun) && munOf(ent, mun) ? mun : "";
  const l = m && /^\d{4}$/.test(loc) ? loc : "";
  const pt = l ? localidadMx(ent, m, l) : undefined;
  return { ent, mun: m, loc: l, label: zoneLabel({ ent, mun: m, loc: l }), lat: pt?.lat ?? null, lng: pt?.lng ?? null };
}
