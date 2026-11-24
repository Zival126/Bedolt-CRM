// Prompt « Créer mon fichier avec Gemini » (Sources > Import Excel). Sans accès à la base : utilisable côté navigateur.
// Le format demandé est exactement celui que l'import reconnaît (18 colonnes, aucun écran de correspondance).

export const GEMINI_HEADER = "Entreprise,Téléphone,Statut,Niche,Offre,Présence web,Angle,Notes,Note Google,Avis,Lien Google Maps,Message WhatsApp,Email,Site web,Facebook,Instagram,Adresse,Ville";
export const GEMINI_URL = "https://gemini.google.com/app";

export type PromptInput = {
  zone: string; niches: { label: string; keywords: string[] }[]; nombre: number; criteres: string; offre: string; message: string;
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function buildGeminiPrompt(i: PromptInput): string {
  const labels = i.niches.map((n) => n.label);
  const mots = [...new Set(i.niches.flatMap((n) => (n.keywords.length ? n.keywords : [n.label])))];
  const offre = clean(i.offre);
  const msg = clean(i.message);
  return [
    "Tu es un assistant de prospection. Utilise Google Maps / Google Search pour trouver de vrais commerces.",
    `Zone : ${clean(i.zone) || "(précise la zone)"} (et uniquement cette zone).`,
    `Types de commerces : ${labels.join(", ") || "(choisis au moins une niche)"} (mots-clés de recherche : ${mots.join(", ")}).`,
    `Nombre visé : ${Math.max(1, Math.floor(i.nombre) || 100)} commerces différents.`,
    `Priorité : ${clean(i.criteres) || "aucune en particulier"}.`,
    "Règles strictes :",
    "- N'invente RIEN. Chaque ligne doit correspondre à un commerce réel visible sur Google Maps. Si une information n'est pas affichée, laisse la cellule vide.",
    "- Pas de doublons (même nom + même adresse, ou même téléphone).",
    "- Téléphone au format +52 XXX XXX XXXX tel qu'affiché sur la fiche Google.",
    "- « Présence web » : « Aucun site » si la fiche Google n'a pas de site web, sinon « Site » ; mets l'adresse du site dans la colonne Site web.",
    "- « Note Google » : nombre décimal (ex. 4.6). « Avis » : nombre entier.",
    "- « Lien Google Maps » : le lien de la fiche du commerce.",
    `- « Niche » : une de ces valeurs exactement : ${labels.join(" | ")}.`,
    "- « Notes » : le quartier / la colonia.",
    "- « Statut » : toujours « À contacter ».",
    `- « Offre » : ${offre || "laisse vide"}.`,
    "- « Angle » : une phrase courte et factuelle sur ce qui manque à leur présence en ligne (pas de site, peu de photos, peu d'avis…), uniquement d'après ce que tu vois.",
    `- « Message WhatsApp » : ${msg ? `${msg} (remplace {nom} par le nom du commerce)` : "laisse vide"}.`,
    "Sortie : un fichier CSV UTF-8, séparateur virgule, chaque champ entre guillemets, avec exactement cette ligne d'en-tête :",
    GEMINI_HEADER,
    "Donne uniquement le CSV, sans texte avant ni après. S'il y a trop de résultats pour une seule réponse, fais plusieurs parties avec la même ligne d'en-tête.",
  ].join("\n");
}
