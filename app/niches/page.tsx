import { allNiches, nicheStats } from "@/lib/niches";
import { autoAssign, OSM_CATEGORIES } from "@/lib/category-map";
import { overtureCategories } from "@/lib/overture";
import { scianTitle } from "@/lib/scian";
import { PageHead } from "@/components/ui";
import NichesManager from "@/components/NichesManager";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Niches · Bedolt CRM" };

// Niches : le classement central des prospects (couleur, icône) et ce qui les relie aux sources.
export default async function Niches() {
  await requireSession("redirect");
  const niches = allNiches({ archived: true });
  const titles = Object.fromEntries([...new Set(niches.flatMap((n) => n.scian))].map((c) => [c, scianTitle(c)]));
  return (
    <>
      <PageHead title="Niches" lead="Classe tes prospects par type de commerce. La couleur et l'icône d'une niche se retrouvent partout : listes, carte, file du jour, stats."
        help={<>
          <p>Une niche regroupe ce qui permet de la reconnaître automatiquement :</p>
          <ul>
            <li><b>Codes SCIAN</b> : activités du registre DENUE (INEGI) ; la classe la plus précise l'emporte.</li>
            <li><b>Tags OpenStreetMap</b> (ex. <code>shop=beauty</code>) et <b>catégories Overture</b> (ex. <code>nail_salon</code> ; <code>*</code> = n'importe quel texte, <code>!</code> devant = exclure).</li>
            <li><b>Mots-clés</b> : textes reconnus dans la colonne « Niche » de tes fichiers Excel / Gemini.</li>
          </ul>
          <p>Fusionner deux niches déplace toutes les fiches de l'une vers l'autre ; l'ancien nom devient un mot-clé. Archiver masque la niche des choix sans toucher aux fiches.</p>
        </>} />
      <NichesManager initial={niches} stats={Object.fromEntries(nicheStats())} titles={titles} auto={autoAssign(false).matched}
        osmTags={OSM_CATEGORIES} overtureCats={overtureCategories(300).map((c) => c.c)} />
    </>
  );
}
