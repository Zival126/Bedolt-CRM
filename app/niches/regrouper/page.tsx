import Link from "next/link";
import { buildPlan, lastRegroup, defaultMains } from "@/lib/niche-regroup";
import { PageHead } from "@/components/ui";
import RegroupView from "@/components/RegroupView";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Regrouper les niches · Bedolt CRM" };

// Regrouper les niches : des centaines de petites niches (spécialités) → une dizaine de niches principales.
export default async function Regrouper() {
  await requireSession("redirect");
  return (
    <>
      <nav className="crumbs" aria-label="Fil d'Ariane"><Link href="/niches">Niches</Link><span aria-hidden="true">›</span><span>Regrouper</span></nav>
      <PageHead title="Regrouper les niches" lead="Rattache les petites niches (spécialités, angles) à une dizaine de niches principales. Rien n'est perdu : l'ancien libellé devient la spécialité des fiches."
        help={<><p>La proposition est calculée sans IA : mots-clés français et espagnols du libellé (le premier mot significatif compte le plus), puis l'activité connue des fiches (code DENUE, catégorie Overture / OSM). Une confiance sous 70 % est marquée « incertaine ».</p>
          <p>« Appliquer » sauvegarde la base juste avant, puis fait tout en une seule opération : fiches déplacées, ancien libellé copié dans la spécialité (si vide) et ajouté comme mot-clé de la niche cible, correspondances (SCIAN, OSM, Overture) fusionnées, niches vidées supprimées. « Annuler le dernier regroupement » remet tout comme avant, tant qu'aucune autre modification de niches n'a été faite.</p></>} />
      <RegroupView initial={{ ...buildPlan(), last: lastRegroup() }} defaults={defaultMains()} />
    </>
  );
}
