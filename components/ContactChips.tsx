import Link from "next/link";
import { hrefWith, type SP } from "@/lib/filters";
import { CHIP_GROUPS } from "./chip-groups";

// Filtres rapides en puces (contacts, source, « ne pas contacter ») : un clic ajoute le filtre à l'URL, un 2e le retire.
// Mêmes paramètres sur Commerces et sur la Carte.


export default function ContactChips({ base, sp, sources, map }: { base: string; sp: SP; sources: string[]; map?: boolean }) {
  const cur = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const chip = (k: string, v: string, label: string) => {
    const on = cur(k) === v;
    return <Link key={k + v} href={hrefWith(base, sp, { [k]: on ? undefined : v })} className={on ? "on" : ""} aria-pressed={on} scroll={false}>{label}</Link>;
  };
  const dncItems: [string, string][] = map ? [["tous", "afficher"], ["1", "seulement"]] : [["0", "masquer"], ["1", "seulement"]];
  return (
    <div className="chips scroll contact-chips" aria-label="Filtres rapides">
      {CHIP_GROUPS.map((g) => (
        <span key={g.key} className="chip-group"><span className="chip-label">{g.label}</span>{g.items.map(([v, l]) => chip(g.key, v, l))}</span>
      ))}
      {sources.length > 1 && <span className="chip-group"><span className="chip-label">Source</span>{sources.map((s) => chip("source", s, s))}</span>}
      <span className="chip-group"><span className="chip-label">⛔ Ne pas contacter</span>{dncItems.map(([v, l]) => chip("dnc", v, l))}</span>
    </div>
  );
}
