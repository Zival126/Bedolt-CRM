import OverturePanel from "@/components/sources/OverturePanel";
import SourceHead from "@/components/SourceHead";
import { overtureMeta, overtureCount, overtureCategories } from "@/lib/overture";
import { allNiches, nicheList } from "@/lib/niches";
import { municipiosWithSeat } from "@/lib/geo-qroo";
import { tileConfig } from "@/lib/tiles";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overture · Bedolt CRM" };

export default async function OvertureSource() {
  await requireSession("redirect");
  const withCats = new Set(allNiches().filter((n) => n.overture.some((v) => !v.startsWith("!"))).map((n) => n.id));
  return (
    <>
      <SourceHead title="Overture" lead="Grande base gratuite de commerces (Meta, Microsoft…), mise à jour chaque mois. Quintana Roo seulement pour l'instant. Souvent téléphone + réseaux."
        help={<p>Recherche dans une copie locale (aucune requête réseau au moment de chercher). Les catégories Overture de chaque niche se règlent dans la page Niches. La « fiabilité » est le score de confiance d'Overture sur l'existence du lieu.</p>} />
      <OverturePanel meta={overtureMeta()} count={overtureCount()} categories={overtureCategories()} niches={nicheList(false).filter((n) => withCats.has(n.id))}
        municipios={municipiosWithSeat().municipios} tiles={tileConfig()} />
    </>
  );
}
