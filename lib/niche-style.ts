// Couleurs et icônes des niches (sans accès à la base : utilisable côté navigateur).
// Palette choisie pour rester lisible sur fond sombre (contraste ≥ 4,5:1 sur #08090a) et se distinguer des couleurs de
// statut, qui sont affichées autrement (pastille + contour) : une niche est toujours une puce PLEINE avec son icône.

export type NicheLite = { id: number; label: string; color: string; icon: string };

export const PALETTE: [string, string][] = [
  ["#f472b6", "Rose"], ["#22d3ee", "Cyan"], ["#a3e635", "Citron vert"], ["#facc15", "Jaune"], ["#c084fc", "Lilas"],
  ["#ff7a59", "Corail"], ["#e2b48a", "Sable"], ["#a5b4fc", "Pervenche"], ["#86efac", "Menthe"], ["#f87171", "Rouge"],
  ["#2dd4bf", "Turquoise"], ["#e879f9", "Fuchsia"], ["#fdba74", "Pêche"], ["#38bdf8", "Ciel"],
];
export const NO_NICHE: NicheLite = { id: 0, label: "Sans niche", color: "#6b7079", icon: "tag" };

export const isHexColor = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

/** Couleur la moins utilisée de la palette (nouvelle niche). */
export function nextColor(used: string[]): string {
  const n = new Map(PALETTE.map(([c]) => [c, 0]));
  for (const u of used) if (n.has(u.toLowerCase())) n.set(u.toLowerCase(), n.get(u.toLowerCase())! + 1);
  let best = PALETTE[0][0], min = Infinity;
  for (const [c] of PALETTE) if (n.get(c)! < min) { min = n.get(c)!; best = c; }
  return best;
}

/** Icônes simples (SVG 24 × 24, trait), fournies par l'appli : aucun CDN. */
export const NICHE_ICONS: Record<string, [string, string]> = {
  tag: ["Étiquette", "M3 12V4h8l9 9-8 8zM7.5 7.5h.01"],
  scissors: ["Ciseaux", "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"],
  sparkles: ["Étoiles", "M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"],
  barber: ["Barbier", "M8 3h8M8 21h8M9 3v18M15 3v18M9 7l6 4M9 13l6 4"],
  flower: ["Spa", "M12 21c-4 0-7-3-7-7 3 0 5 1 7 3 2-2 4-3 7-3 0 4-3 7-7 7zM12 17c-2-2-2-6 0-10 2 4 2 8 0 10z"],
  tooth: ["Dent", "M7 3C4.5 3 3 5 3 7.5c0 3 1.5 4.5 2 7 .5 3 1 6.5 3 6.5s2-4 4-4 2 4 4 4 2.5-3.5 3-6.5c.5-2.5 2-4 2-7C21 5 19.5 3 17 3c-2 0-3 1-5 1S9 3 7 3z"],
  health: ["Santé", "M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"],
  heart: ["Cœur", "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"],
  utensils: ["Restaurant", "M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 21V3c-2 1-3.5 3.5-3.5 7s1.5 4 3.5 4"],
  coffee: ["Café", "M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3"],
  glass: ["Bar", "M5 4h14l-7 8zM12 12v8M8 20h8"],
  dumbbell: ["Sport", "M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"],
  paw: ["Animaux", "M8.5 9a2 2.5 0 1 0 0-5 2 2.5 0 0 0 0 5zM15.5 9a2 2.5 0 1 0 0-5 2 2.5 0 0 0 0 5zM5 13.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 13.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 12c-3 0-5 3.5-5 5.5 0 1.5 1 2.5 2.5 2.5s1.5-.5 2.5-.5 1 .5 2.5.5 2.5-1 2.5-2.5c0-2-2-5.5-5-5.5z"],
  car: ["Auto", "M5 17h14v-5l-2-5H7l-2 5zM5 12h14M7.5 17v2M16.5 17v2M8 14.5h.01M16 14.5h.01"],
  wrench: ["Atelier", "M15 4a5 5 0 0 0-4.8 6.4L4 16.6V20h3.4l6.2-6.2A5 5 0 0 0 20 9l-3 1-2-2 1-3z"],
  home: ["Maison", "M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6"],
  bag: ["Boutique", "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"],
  shirt: ["Mode", "M8 4 3 7l2 4 2-1v10h10V10l2 1 2-4-5-3a4 4 0 0 1-8 0z"],
  bed: ["Hôtel", "M3 18V8M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5h.01"],
  book: ["École", "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5"],
  camera: ["Photo", "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"],
  music: ["Musique", "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"],
  leaf: ["Nature", "M5 19c0-9 6-14 15-14 0 9-5 15-14 15M5 19l7-7"],
  briefcase: ["Bureau", "M4 8h16v11H4zM9 8V5h6v3M4 13h16"],
  palette: ["Art", "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1-.8-1.2-.8-2.2 0-.9.7-1.3 1.6-1.3H17a4 4 0 0 0 4-4c0-5-4-9-9-9zM7.5 11h.01M10 7h.01M15 7.5h.01"],
  store: ["Commerce", "M4 10h16v10H4zM3 10l2-6h14l2 6M9 20v-5h6v5"],
};
export const iconPath = (name: string) => (NICHE_ICONS[name] ?? NICHE_ICONS.tag)[1];
export const isIcon = (name: string) => name in NICHE_ICONS;
