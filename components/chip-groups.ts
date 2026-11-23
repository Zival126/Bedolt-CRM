// Groupes de puces de filtres de contact (partagés : Commerces côté serveur, Carte côté navigateur).
export const CHIP_GROUPS: { key: string; label: string; items: [string, string][] }[] = [
  { key: "tel", label: "📞", items: [["1", "avec tél."], ["0", "sans tél."]] },
  { key: "email", label: "✉️", items: [["1", "avec email"], ["0", "sans email"]] },
  { key: "site", label: "🌐", items: [["1", "avec site"], ["0", "sans site"]] },
  { key: "wa", label: "WhatsApp", items: [["oui", "oui"], ["non", "non"], ["inconnu", "inconnu"]] },
  { key: "pos", label: "📍", items: [["1", "avec position"], ["0", "sans position"]] },
];
