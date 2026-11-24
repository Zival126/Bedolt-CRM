// Icônes de navigation (SVG inline, trait 1.8 px).
const P: Record<string, string> = {
  today: "M4 7h16M4 12h16M4 17h10",
  focus: "M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  commerces: "M4 10h16v10H4zM3 10l2-6h14l2 6M9 20v-5h6v5",
  pipeline: "M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v5h-4z",
  clients: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6",
  stats: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  import: "M12 3v12M7 10l5 5 5-5M4 21h16",
  denue: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  reglages: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-2-4-2 1-2-1.5V4h-4v2.5L9 8 7 7l-2 4 2 1v0l-2 1 2 4 2-1 2 1.5V20h4v-2.5l2-1.5 2 1 2-4z",
  plus: "M5 12h.01M12 12h.01M19 12h.01",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
  niches: "M3 12V4h8l9 9-8 8zM7.5 7.5h.01",
  sources: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M11 8v6M8 11h6",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  close: "M6 6l12 12M18 6 6 18",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
};
export default function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[name] ?? ""} /></svg>;
}
