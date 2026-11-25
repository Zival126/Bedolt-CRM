import Link from "next/link";
import { notFound } from "next/navigation";
import ApiSourcePanel from "@/components/sources/ApiSourcePanel";
import SourceHead from "@/components/SourceHead";
import { PROVIDERS, API_KEYS, apiEnabled, apiUsage, apiCap, apiStorage, type ApiKey } from "@/lib/places-api";
import { allNiches } from "@/lib/niches";
import { entidades, favoris, zoneLabel, localidadMx } from "@/lib/geo-mx";
import { tileConfig } from "@/lib/tiles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const WHAT: Record<ApiKey, string> = {
  foursquare: "Base mondiale de lieux (applications Foursquare / Swarm) : bonne couverture des cafés, restaurants, salons et commerces urbains.",
  here: "Base de lieux de HERE (cartes des voitures, navigation) : bonne couverture des commerces avec adresse et souvent téléphone / site.",
  tomtom: "Base de points d'intérêt de TomTom (GPS) : utile pour l'auto, les services et les commerces de quartier.",
  google: "La base de Google Maps : la plus complète, mais la plus chère et la plus restrictive (seul l'identifiant peut être gardé).",
};

export async function generateMetadata({ params }: { params: Promise<{ provider: string }> }) {
  const p = (await params).provider as ApiKey;
  return { title: `${PROVIDERS[p]?.label ?? "Source"} · Bedolt CRM` };
}

export default async function ApiSource({ params }: { params: Promise<{ provider: string }> }) {
  await requireSession("redirect");
  const p = (await params).provider as ApiKey;
  if (!API_KEYS.includes(p)) notFound();
  const prov = PROVIDERS[p];
  const enabled = apiEnabled(p);
  const niches = allNiches().filter((n) => n[p].some((v) => !v.startsWith("!"))).map((n) => ({ id: n.id, label: n.label, color: n.color, icon: n.icon }));
  const cancun = localidadMx("23", "005", "0001");
  const def = { ent: "23", mun: "005", loc: "0001", label: zoneLabel({ ent: "23", mun: "005", loc: "0001" }), lat: cancun?.lat ?? 21.1619, lng: cancun?.lng ?? -86.8515 };
  return (
    <>
      <SourceHead title={prov.label} lead={WHAT[p]}
        help={<>
          <p><b>Offre gratuite</b> : {prov.free}</p>
          <p><b>Conditions d'utilisation</b> : {prov.storageNote}</p>
          <p><b>Clé</b> : {prov.keyHelp}, puis redémarre le CRM. Elle reste sur le serveur, jamais dans le navigateur.</p>
          <p>Chaque niche choisie = 1 appel ; un plafond mensuel (Réglages › Sources & clés) bloque toute recherche qui le dépasserait. Termes de recherche par niche : page Niches, onglet {prov.label} ({prov.termHelp}). Aucune niche n'est créée par la source.</p>
        </>} />
      {!enabled ? (
        <div className="card stack">
          <span className="state warn" style={{ alignSelf: "flex-start" }}>Clé requise</span>
          <p style={{ margin: 0 }}>Cette source est désactivée : aucune requête n'est faite sans clé.</p>
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{prov.keyHelp}.</li>
            <li>Sur le serveur : ajoute <code>{prov.env}=ta_clé</code> dans <code>/var/www/bedolt-crm/.env</code>, puis redémarre le CRM.</li>
            <li>Règle le plafond mensuel dans <Link href="/reglages#sources">Réglages › Sources & clés</Link>.</li>
          </ol>
        </div>
      ) : (
        <ApiSourcePanel provider={p} label={prov.label} enabled={enabled} used={apiUsage(p)} cap={apiCap(p)} restricted={apiStorage(p) === "id"} niches={niches}
          entidades={entidades().map((e) => ({ code: e.c, nom: e.n }))} favoris={favoris().map((f) => ({ ...f }))} defaultZone={def} tiles={tileConfig()} attribution={prov.attribution} />
      )}
    </>
  );
}
