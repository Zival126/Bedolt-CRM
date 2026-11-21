// Fonction partagée client/serveur (lib/import.ts importe exceljs, qu'on ne veut pas côté navigateur).
export const normHeader = (h: string) =>
  h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Libellés des champs d'import (écran de correspondance). */
export const FIELD_LABELS: Record<string, string> = {
  nom: "Nom (Entreprise)", activite: "Activité", telephone: "Téléphone", whatsapp: "WhatsApp (si différent)", email: "Email",
  site_web: "Site web", adresse: "Adresse", colonia: "Colonia", ville: "Ville", fiche_google: "Fiche Google",
  lien_google_maps: "Lien Google Maps", note_google: "Note Google", nb_avis: "Nb d'avis", latitude: "Latitude",
  longitude: "Longitude", notes: "Notes", statut: "Statut", niche: "Niche", offre: "Offre", presence_web: "Présence web",
  angle: "Angle", zone: "Zone", message_whatsapp: "Message WhatsApp",
};
