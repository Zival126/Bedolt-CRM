"use client";
import { useEffect, useRef, useState } from "react";
import { getJson } from "./client-api";

export type ZoneVal = { ent: string; mun: string; loc: string; label: string; lat?: number | null; lng?: number | null };
type Hit = ZoneVal & { type: "entidad" | "municipio" | "localidad"; sub: string; pop: number };
type Opt = { code: string; nom: string; p?: number; u?: number; lat?: number | null; lng?: number | null };
const TYPE = { entidad: "État", municipio: "municipio", localidad: "ville" } as const;

/**
 * Choix d'une zone au Mexique : favoris (1 clic), recherche instantanée (« monterrey », « cdmx », « playa »…), ou
 * sélection État → municipio → localidad. `level="state"` : État seulement (Nom / mot-clé, Marché) ; `allowCountry` :
 * « Tout le Mexique » (00).
 */
export default function ZonePicker({ value, onChange, entidades, favoris, level = "full", allowCountry, label = "Zone" }: {
  value: ZoneVal; onChange: (z: ZoneVal) => void; entidades: { code: string; nom: string }[]; favoris: ZoneVal[];
  level?: "full" | "state"; allowCountry?: boolean; label?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [munis, setMunis] = useState<Opt[]>([]);
  const [locs, setLocs] = useState<Opt[] | null>(null);
  const [locSource, setLocSource] = useState("");
  const seq = useRef(0);
  const stateOnly = level === "state";

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits([]); return; }
    const n = ++seq.current;
    const h = setTimeout(() => {
      getJson<{ hits: Hit[] }>("/api/geo/search?q=" + encodeURIComponent(t)).then((r) => {
        if (n !== seq.current) return;
        setHits(stateOnly ? r.hits.filter((x) => x.type === "entidad") : r.hits); setActive(0); setOpen(true);
      }).catch(() => {});
    }, 120);
    return () => clearTimeout(h);
  }, [q, stateOnly]);

  // Niveaux : municipios de l'État, localidades du municipio (rurales comprises, chargées à la demande)
  useEffect(() => {
    if (stateOnly || !value.ent || value.ent === "00") { setMunis([]); return; }
    let stale = false;
    getJson<{ municipios: Opt[] }>("/api/geo/zone?ent=" + value.ent).then((r) => { if (!stale) setMunis(r.municipios); }).catch(() => {});
    return () => { stale = true; };
  }, [value.ent, stateOnly]);
  useEffect(() => {
    if (stateOnly || !value.ent || !value.mun) { setLocs(null); return; }
    let stale = false;
    setLocs(null);
    getJson<{ localidades: Opt[]; source: string }>(`/api/geo/zone?ent=${value.ent}&mun=${value.mun}`)
      .then((r) => { if (!stale) { setLocs(r.localidades); setLocSource(r.source); } }).catch(() => { if (!stale) setLocs([]); });
    return () => { stale = true; };
  }, [value.ent, value.mun, stateOnly]);

  const entName = (c: string) => (c === "00" ? "Tout le Mexique" : entidades.find((e) => e.code === c)?.nom ?? c);
  const pick = (z: ZoneVal) => { onChange(stateOnly ? { ent: z.ent, mun: "", loc: "", label: entName(z.ent), lat: z.lat, lng: z.lng } : z); setQ(""); setOpen(false); };
  const setLevel = (ent: string, mun = "", loc = "") => {
    const m = munis.find((x) => x.code === mun), l = locs?.find((x) => x.code === loc);
    const label = !ent ? "" : ent === "00" ? "Tout le Mexique" : !mun ? entName(ent) : !loc ? `${m?.nom ?? mun} (${entName(ent)})` : `${l?.nom ?? loc} — ${m?.nom ?? mun}, ${entName(ent)}`;
    onChange({ ent, mun, loc, label, lat: l?.lat ?? null, lng: l?.lng ?? null });
  };
  const favs = stateOnly ? favoris.filter((f) => !f.mun) : favoris;
  const same = (a: ZoneVal, b: ZoneVal) => a.ent === b.ent && a.mun === b.mun && a.loc === b.loc;

  return (
    <div className="stack zonepick" style={{ gap: 8 }}>
      <div className="row spread"><b className="small">{label}</b>
        {value.ent && <span className="zone-current" title={value.label}>{value.label || entName(value.ent)}</span>}</div>
      {favs.length > 0 && (
        <div className="chips scroll" aria-label="Zones favorites">
          {favs.map((f) => <button key={f.ent + f.mun + f.loc} type="button" className={same(f, value) ? "on" : ""} onClick={() => pick(f)}>{f.label}</button>)}
        </div>
      )}
      <div className="scian-search">
        <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} role="combobox" aria-expanded={open} aria-autocomplete="list"
          placeholder={stateOnly ? "Chercher un État (ex. jalisco, cdmx)…" : "Chercher un État, un municipio ou une ville : monterrey, cdmx, playa, merida…"} aria-label="Chercher une zone"
          onKeyDown={(e) => {
            if (!open || !hits.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === "Enter") { e.preventDefault(); pick(hits[active]); }
            if (e.key === "Escape") setOpen(false);
          }} />
        {open && q.trim().length >= 2 && (
          <div className="scian-hits" role="listbox">
            {hits.length === 0 && <div className="small muted" style={{ padding: 10 }}>Aucune zone trouvée.</div>}
            {hits.map((h, i) => (
              <button key={h.ent + h.mun + h.loc} type="button" role="option" aria-selected={i === active} className={i === active ? "on" : ""} onMouseEnter={() => setActive(i)} onClick={() => pick(h)}>
                <span className="row spread" style={{ flexWrap: "nowrap" }}><b>{h.label}</b><span className="tiny muted">{TYPE[h.type]}</span></span>
                {h.pop > 0 && <span className="tiny muted">{h.pop.toLocaleString("fr-FR")} hab.</span>}
              </button>
            ))}
            <button type="button" className="close" onClick={() => setOpen(false)}>Fermer</button>
          </div>
        )}
      </div>
      <details className="zone-levels">
        <summary className="small muted">{stateOnly ? "Choisir dans la liste des États" : "Choisir par niveaux : État → municipio → localidad"}</summary>
        <div className={stateOnly ? "grid g1" : "grid gform"} style={{ marginTop: 8 }}>
          <label className="f">État
            <select value={value.ent} onChange={(e) => setLevel(e.target.value)}>
              {allowCountry && <option value="00">Tout le Mexique (volume important)</option>}
              {!value.ent && <option value="">— choisir —</option>}
              {entidades.map((e) => <option key={e.code} value={e.code}>{e.nom}</option>)}
            </select></label>
          {!stateOnly && <label className="f">Municipio
            <select value={value.mun} onChange={(e) => setLevel(value.ent, e.target.value)} disabled={!value.ent || value.ent === "00"}>
              <option value="">Tout l'État</option>
              {munis.map((m) => <option key={m.code} value={m.code}>{m.nom}</option>)}
            </select></label>}
          {!stateOnly && <label className="f">Localidad
            <select value={value.loc} onChange={(e) => setLevel(value.ent, value.mun, e.target.value)} disabled={!value.mun}>
              <option value="">Tout le municipio</option>
              {value.mun && locs === null && <option disabled>Chargement…</option>}
              {(locs ?? []).map((l) => <option key={l.code} value={l.code}>{l.nom}{l.p ? ` (${l.p.toLocaleString("fr-FR")} hab.)` : ""}</option>)}
            </select></label>}
        </div>
        {!stateOnly && value.mun && locs && <span className="tiny muted">{locs.length.toLocaleString("fr-FR")} localidades{locSource === "catalogue" ? " (service INEGI injoignable : localidades principales seulement)" : ""}.</span>}
      </details>
    </div>
  );
}
