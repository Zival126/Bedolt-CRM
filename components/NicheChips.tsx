"use client";
import { NicheIcon } from "./ui";
import { NO_NICHE, type NicheLite } from "@/lib/niche-style";

/**
 * Puces de niches colorées, multi-sélection (aucune cochée = toutes). `counts` : nombre par niche (0 = sans niche),
 * `withNone` : puce « Sans niche ».
 */
export default function NicheChips({ niches, value, onChange, counts, withNone, label = "Niches", single, scroll = true, clearLabel = "Toutes" }: {
  niches: NicheLite[]; value: number[]; onChange: (v: number[]) => void; counts?: Record<number, number>; withNone?: boolean;
  label?: string; single?: boolean; scroll?: boolean; clearLabel?: string | null;
}) {
  const list = withNone ? [...niches, NO_NICHE] : niches;
  const toggle = (id: number) => onChange(single ? (value.includes(id) ? [] : [id]) : value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className={"nchips" + (scroll ? " scroll" : "")} role="group" aria-label={label}>
      {list.map((n) => {
        const on = value.includes(n.id);
        const c = counts?.[n.id];
        return (
          <button key={n.id} type="button" className={"nchip" + (on ? " on" : "") + (n.id === 0 ? " none" : "")} aria-pressed={on}
            style={{ "--n": n.color } as React.CSSProperties} onClick={() => toggle(n.id)} disabled={c === 0 && !on}>
            <NicheIcon icon={n.icon} size={14} /><span>{n.label}</span>{c != null && <span className="nchip-c">{c.toLocaleString("fr-FR")}</span>}
          </button>
        );
      })}
      {value.length > 0 && !single && clearLabel && <button type="button" className="nchip-clear" onClick={() => onChange([])}>{clearLabel}</button>}
    </div>
  );
}
