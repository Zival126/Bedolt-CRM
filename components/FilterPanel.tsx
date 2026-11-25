"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import NicheChips from "./NicheChips";
import Icon from "./Icon";
import { STATUTS, FICHES, statutLabel } from "@/lib/constants";
import type { NicheLite } from "@/lib/niche-style";

// Filtres partagés par Commerces et la Carte : puces de niches, recherche, panneau latéral / feuille du bas par sections
// (Statut, Lieu, Contact, Qualité, Source), compteur de filtres actifs, « Tout effacer ». Tout vit dans l'URL.

export type FilterOptions = {
  villes: string[]; zones: string[]; offres: string[]; webs: string[]; tags: string[];
  lots: { id: number; file_name: string }[]; sources: string[]; etats: { c: string; n: string; k: number }[];
};
type Mode = "list" | "map";
const SRC: Record<string, string> = { excel: "Excel / Gemini", denue: "DENUE", osm: "OpenStreetMap", overture: "Overture", manuel: "Manuel", google: "Google", foursquare: "Foursquare", here: "HERE", tomtom: "TomTom" };
const PANEL_KEYS = ["statut", "etat", "ville", "zone", "tel", "email", "site", "wa", "pos", "dnc", "offre", "fiche", "web", "webscore", "note_min", "avis_min", "msg", "source", "lot", "tag", "file", "niche"] as const;
const YES_NO: Record<string, [string, string, string]> = { tel: ["Téléphone", "avec téléphone", "sans téléphone"], email: ["Email", "avec email", "sans email"], site: ["Site web", "avec site", "sans site"], pos: ["Position", "sur la carte", "sans position"] };

function label(k: string, v: string, mode: Mode, o: FilterOptions): string {
  if (k === "statut") return v === "actifs" ? "Sans les perdus" : v === "tous" ? "Tous statuts" : statutLabel(v);
  if (k in YES_NO) return YES_NO[k][v === "1" ? 1 : 2];
  if (k === "wa") return `WhatsApp : ${v}`;
  if (k === "dnc") return v === "1" ? "Ne pas contacter seulement" : v === "0" ? "Sans « ne pas contacter »" : "Avec « ne pas contacter »";
  if (k === "fiche") return `Fiche Google : ${v === "none" ? "non renseignée" : FICHES.find((f) => f.key === v)?.label ?? v}`;
  if (k === "note_min") return `Note ≥ ${v}`;
  if (k === "avis_min") return `≥ ${v} avis`;
  if (k === "msg") return v === "1" ? "Avec message WhatsApp" : "Sans message WhatsApp";
  if (k === "source") return SRC[v] ?? v;
  if (k === "lot") return `Import #${v}`;
  if (k === "file") return "Dans la file du jour";
  if (k === "etat") return o.etats.find((e) => e.c === v)?.n ?? (v === "none" ? "État non renseigné" : v);
  if (k === "q") return `« ${v} »`;
  if (k === "webscore") return ({ lt50: "Score web < 50", ok: "Score web ≥ 50", nosite: "Aucun site", todo: "Site pas encore analysé" } as Record<string, string>)[v] ?? v;
  if (k === "niche") return `Niche (texte) : ${v}`;
  if (v === "none") return `${k === "web" ? "Présence web" : k[0].toUpperCase() + k.slice(1)} : non renseignée`;
  return v;
}

/** Filtres actifs (hors niches et valeurs par défaut de la carte). */
export function activeFilters(sp: URLSearchParams, mode: Mode) {
  return [...PANEL_KEYS, "q" as const].filter((k) => {
    const v = sp.get(k);
    if (!v) return false;
    if (mode === "map" && ((k === "statut" && v === "actifs") || (k === "dnc" && v === "0"))) return false;
    return true;
  });
}

export default function FilterPanel({ mode, options, niches, counts, extra, total, children }: {
  mode: Mode; options: FilterOptions; niches: NicheLite[]; counts?: Record<number, number>; extra?: React.ReactNode; total?: React.ReactNode; children?: React.ReactNode;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(sp.get("q") ?? "");
  useEffect(() => setQ(sp.get("q") ?? ""), [sp]);
  const go = (p: URLSearchParams) => { p.delete("page"); router.replace(path + (p.size ? "?" + p : ""), { scroll: false }); };
  const set = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) { if (v === null || v === "") p.delete(k); else p.set(k, v); }
    go(p);
  };
  const nIds = (sp.get("n") ?? "").split(",").filter(Boolean).map(Number).filter((x) => Number.isInteger(x));
  const act = activeFilters(sp, mode);
  const clearAll = () => { const p = new URLSearchParams(); const vue = sp.get("vue"); if (vue && mode === "list") p.set("vue", vue); if (sp.get("grp")) p.set("grp", sp.get("grp")!); go(p); };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <NicheChips niches={niches} value={nIds} counts={counts} withNone onChange={(v) => set({ n: v.length ? v.join(",") : null })} />
      <div className="fbar">
        <form className="search-field" role="search" onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() || null }); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou téléphone" aria-label="Rechercher par nom ou téléphone" inputMode="search" />
          <button className="btn icon" aria-label="Rechercher"><Icon name="search" size={18} /></button>
        </form>
        <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(true)}>Filtres{act.filter((k) => k !== "q").length ? <span className="fcount">{act.filter((k) => k !== "q").length}</span> : null}</button>
        {extra}
      </div>
      {(act.length > 0 || nIds.length > 0 || total) && (
        <div className="active-filters" aria-label="Filtres actifs">
          {total}
          {act.map((k) => <button key={k} type="button" onClick={() => set({ [k]: null })} aria-label={`Retirer le filtre ${label(k, sp.get(k)!, mode, options)}`}>{label(k, sp.get(k)!, mode, options)} ×</button>)}
          {(act.length > 0 || nIds.length > 0) && <button type="button" className="link small" style={{ background: "none", border: 0, color: "var(--accent)" }} onClick={clearAll}>Tout effacer</button>}
        </div>
      )}
      {children}
      {open && <Panel mode={mode} options={options} sp={sp} onClose={() => setOpen(false)} onApply={(p) => { setOpen(false); go(p); }} onClear={() => { setOpen(false); clearAll(); }} />}
    </div>
  );
}

function Panel({ mode, options: o, sp, onClose, onApply, onClear }: { mode: Mode; options: FilterOptions; sp: URLSearchParams; onClose: () => void; onApply: (p: URLSearchParams) => void; onClear: () => void }) {
  const [d, setD] = useState(() => Object.fromEntries(PANEL_KEYS.map((k) => [k, sp.get(k) ?? ""])) as Record<(typeof PANEL_KEYS)[number], string>);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });
  const seg = (k: keyof typeof d, items: [string, string][]) => (
    <div className="ms">{items.map(([v, l]) => <button key={v || "_"} type="button" className={"sm" + (d[k] === v ? " on" : "")} aria-pressed={d[k] === v} onClick={() => setD({ ...d, [k]: v })}>{l}</button>)}</div>
  );
  const sel = (k: keyof typeof d, lab: string, values: string[], none = true) => (
    <label className="f">{lab}<select value={d[k]} onChange={set(k)}>
      <option value="">Toutes</option>{none && <option value="none">Non renseignée</option>}{values.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
  );
  function apply() {
    const p = new URLSearchParams(sp.toString());
    for (const k of PANEL_KEYS) { if (d[k]) p.set(k, d[k]); else p.delete(k); }
    onApply(p);
  }
  const statutItems: [string, string][] = mode === "map"
    ? [["", "Tous sauf Perdu"], ["tous", "Tous"], ...STATUTS.map((s) => [s.key, s.label] as [string, string])]
    : [["", "Selon la vue"], ["actifs", "Sans les perdus"], ...STATUTS.map((s) => [s.key, s.label] as [string, string])];
  const dncItems: [string, string][] = mode === "map" ? [["", "Masquées"], ["tous", "Affichées"], ["1", "Seulement elles"]] : [["", "Toutes"], ["0", "Masquées"], ["1", "Seulement elles"]];
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Filtres">
        <div className="drawer-h"><b>Filtres</b><button type="button" className="btn ghost icon" aria-label="Fermer" onClick={onClose}><Icon name="close" size={18} /></button></div>
        <div className="drawer-b">
          <div className="fsec"><b>Statut</b>{seg("statut", statutItems)}</div>
          <div className="fsec"><b>Lieu</b>
            <div className="grid g2">
              {(o.etats.length > 1 || d.etat) && <label className="f">État<select value={d.etat} onChange={set("etat")}><option value="">Tous</option>
                {o.etats.map((x) => <option key={x.c} value={x.c}>{x.n || x.c} ({x.k})</option>)}<option value="none">Non renseigné</option></select></label>}
              {sel("ville", "Ville", o.villes, false)}
              {sel("zone", "Zone / quartier", o.zones)}
            </div></div>
          <div className="fsec"><b>Contact</b>
            {(["tel", "email", "site", "pos"] as const).map((k) => <div key={k} className="row" style={{ gap: 8 }}><span className="small" style={{ minWidth: 84 }}>{YES_NO[k][0]}</span>
              {seg(k, [["", "Peu importe"], ["1", "Oui"], ["0", "Non"]])}</div>)}
            <div className="row" style={{ gap: 8 }}><span className="small" style={{ minWidth: 84 }}>WhatsApp</span>{seg("wa", [["", "Peu importe"], ["oui", "Confirmé"], ["inconnu", "Inconnu"], ["non", "Sans"]])}</div>
            <div className="row" style={{ gap: 8 }}><span className="small" style={{ minWidth: 84 }}>⛔ À ne pas contacter</span>{seg("dnc", dncItems)}</div>
          </div>
          <div className="fsec"><b>Qualité</b>
            <div className="grid g2">
              {sel("offre", "Offre", o.offres)}
              <label className="f">Fiche Google<select value={d.fiche} onChange={set("fiche")}><option value="">Toutes</option>
                {FICHES.map((s) => <option key={s.key} value={s.key || "none"}>{s.key ? s.label : "Non renseignée"}</option>)}</select></label>
              <label className="f">Note Google min.<input type="number" step="0.1" min={0} max={5} inputMode="decimal" value={d.note_min} onChange={set("note_min")} placeholder="ex. 4" /></label>
              <label className="f">Nb d'avis min.<input type="number" step="1" min={0} inputMode="numeric" value={d.avis_min} onChange={set("avis_min")} placeholder="ex. 10" /></label>
              {sel("web", "Présence web (fichier)", o.webs)}
              <label className="f">Analyse du site<select value={d.webscore} onChange={set("webscore")}><option value="">Toutes</option>
                <option value="lt50">Score web &lt; 50 (à améliorer)</option><option value="ok">Score web ≥ 50</option><option value="nosite">Aucun site (opportunité)</option><option value="todo">Site pas encore analysé</option></select></label>
              <label className="f">Message WhatsApp<select value={d.msg} onChange={set("msg")}><option value="">Tous</option><option value="1">Avec message préparé</option><option value="0">Sans message</option></select></label>
            </div></div>
          <div className="fsec"><b>Source</b>
            {o.sources.length > 1 && seg("source", [["", "Toutes"], ...o.sources.map((s) => [s, SRC[s] ?? s] as [string, string])])}
            <div className="grid g2">
              <label className="f">Lot d'import<select value={d.lot} onChange={set("lot")}><option value="">Tous</option>{o.lots.map((l) => <option key={l.id} value={l.id}>#{l.id} · {l.file_name}</option>)}</select></label>
              {o.tags.length > 0 && <label className="f">Étiquette<select value={d.tag} onChange={set("tag")}><option value="">Toutes</option>{o.tags.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>}
            </div>
            <label className="chk small" style={{ minHeight: 44 }}><input type="checkbox" checked={d.file === "1"} onChange={(e) => setD({ ...d, file: e.target.checked ? "1" : "" })} />Seulement les fiches de la file du jour</label>
          </div>
        </div>
        <div className="drawer-f"><button type="button" className="btn ghost" onClick={onClear}>Tout effacer</button><button type="button" className="btn primary" onClick={apply}>Appliquer</button></div>
      </div>
    </>
  );
}
