import ImportWizard from "@/components/ImportWizard";
import ImportBatches from "@/components/ImportBatches";
import GeminiPrompt from "@/components/sources/GeminiPrompt";
import SourceHead from "@/components/SourceHead";
import { importBatches } from "@/lib/crm";
import { allNiches, nicheStats } from "@/lib/niches";
import { entidades, favoris, zoneLabel } from "@/lib/geo-mx";
import { getSetting } from "@/lib/settings";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import Excel / Gemini · Bedolt CRM" };

export default async function ExcelSource() {
  await requireSession("redirect");
  // Niches principales actives (les petites niches de 1-2 fiches sont des spécialités : pas dans le prompt)
  const st = nicheStats();
  const niches = allNiches().filter((n) => { const f = st.get(n.id)?.fiches ?? 0; return f === 0 || f >= 3; })
    .sort((a, b) => (st.get(b.id)?.fiches ?? 0) - (st.get(a.id)?.fiches ?? 0))
    .map((n) => ({ id: n.id, label: n.label, color: n.color, icon: n.icon, keywords: n.keywords.slice(0, 8) }));
  const fav = favoris();
  const def = { ent: "23", mun: "005", loc: "", label: zoneLabel({ ent: "23", mun: "005" }) };
  return (
    <>
      <SourceHead title="Import Excel / Gemini" lead="Tes fichiers de recherches (Gemini, Google Maps) : prépare le fichier avec Gemini, puis importe-le."
        help={<><p>Format reconnu automatiquement (19 colonnes) : <code>Entreprise, Téléphone, Statut, Niche, Spécialité, Offre, Présence web, Angle, Notes, Note Google, Avis, Lien Google Maps, Message WhatsApp, Email, Site web, Facebook, Instagram, Adresse, Ville</code>. « Notes » = quartier / colonia.</p>
          <p>La colonne « Niche » est reconnue par le nom des niches, leurs mots-clés, puis un classement par mots-clés ; sinon la fiche reste « Sans niche ». Aucune niche n'est créée sans ton accord, et la valeur du fichier est gardée dans la « Spécialité ». Les lignes douteuses (sans lien Maps ou sans téléphone) sont signalées dans l'aperçu. 5 Mo et 5 000 lignes au plus.</p></>} />
      <div className="stack" style={{ gap: 16 }}>
        <GeminiPrompt niches={niches} entidades={entidades().map((e) => ({ code: e.c, nom: e.n }))} favoris={fav.map((f) => ({ ...f }))} defaultZone={def} message={getSetting("tpl_first")} />
        <div className="stack" style={{ gap: 8 }}>
          <p className="step-t" style={{ fontSize: 17 }}>Importer le fichier</p>
          <ImportWizard niches={niches.map((n) => ({ id: n.id, label: n.label }))} />
        </div>
        <h2>Imports récents</h2>
        <ImportBatches batches={importBatches()} />
      </div>
    </>
  );
}
