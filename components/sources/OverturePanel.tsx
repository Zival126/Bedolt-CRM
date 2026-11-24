"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { postJson } from "../client-api";
import SourceResults, { type SRow } from "./SourceResults";
import type { Bounds } from "../denue/DenueMap";
import type { TileConfig } from "@/lib/tiles";

const DenueMap = dynamic(() => import("../denue/DenueMap"), { ssr: false, loading: () => <div className="denue-map-wrap"><div className="denue-map" /></div> });
type Muni = { code: string; nom: string; seat: string };

// Overture Maps : recherche dans la copie locale (bbox Quintana Roo), aucune requête réseau à la recherche.
export default function OverturePanel({ meta, count, categories, niches, municipios, tiles }: {
  meta: Record<string, string>; count: number; categories: { c: string; n: number }[]; niches: string[]; municipios: Muni[]; tiles: TileConfig;
}) {
  const [f, setF] = useState({ niche: niches[0] ?? "", cats: [] as string[], zone: "005", q: "", tel: false, site: false, social: false, email: false, conf: 0.5, closed: true });
  const [rows, setRows] = useState<SRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [catQ, setCatQ] = useState("");
  const bounds = useRef<Bounds | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  if (!count) return (
    <div className="card stack">
      <b>Aucune donnée Overture chargée</b>
      <p className="small muted" style={{ margin: 0 }}>Lance la première synchronisation sur le VPS (téléchargement de la zone Quintana Roo uniquement, ~50-60 Mo temporaires, quelques minutes) :</p>
      <pre className="code-block">runuser -u bedoltcrm -- bash /var/www/bedolt-crm/scripts/overture-sync.sh</pre>
      <p className="tiny muted" style={{ margin: 0 }}>Ensuite, deploy.sh programme une mise à jour mensuelle (cron de bedoltcrm).</p>
    </div>
  );

  async function search() {
    if (!f.niche && !f.cats.length && !f.q.trim()) return setMsg({ kind: "warn", text: "Choisis une niche, des catégories ou un nom." });
    setBusy(true); setMsg(null); setSelected(null);
    try {
      const zone = f.zone === "carte" ? { bbox: bounds.current ?? undefined } : f.zone ? { municipio: f.zone } : {};
      const r = await postJson<{ rows: SRow[]; total: number }>("/api/sources/overture", {
        categories: f.cats, niche: f.niche || undefined, q: f.q.trim() || undefined, ...zone,
        tel: f.tel || undefined, site: f.site || undefined, social: f.social || undefined, email: f.email || undefined, minConfidence: f.conf || undefined, excludeClosed: f.closed,
      });
      setRows(r.rows);
      setLabel(`Overture ${[f.niche, ...f.cats].filter(Boolean).join(", ")} · ${f.zone === "carte" ? "zone de la carte" : municipios.find((m) => m.code === f.zone)?.nom ?? "Quintana Roo"}`);
      setMsg({ kind: "", text: `${r.total.toLocaleString("fr-FR")} lieu(x)${r.total > r.rows.length ? ` · ${r.rows.length} affichés (les plus fiables)` : ""}.` });
    } catch (e) { setMsg({ kind: "bad", text: (e as Error).message }); }
    setBusy(false);
  }
  const cats = categories.filter((c) => !catQ || c.c.includes(catQ.toLowerCase().replace(/\s+/g, "_")));

  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="card stack" style={{ gap: 10 }}>
        <div className="tiny muted">Version {meta.release ?? "?"} · {count.toLocaleString("fr-FR")} lieux chargés le {meta.loaded_at ? new Date(meta.loaded_at).toLocaleDateString("fr-FR") : "?"} · zone {meta.bbox ?? "Quintana Roo"}</div>
        <div className="grid gform">
          <label className="f">Niche (catégories correspondantes)
            <select value={f.niche} onChange={(e) => set("niche", e.target.value)}><option value="">— aucune —</option>{niches.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="f">Zone
            <select value={f.zone} onChange={(e) => set("zone", e.target.value)}>
              <option value="">Tout le Quintana Roo</option><option value="carte">Zone visible de la carte</option>
              {municipios.map((m) => <option key={m.code} value={m.code}>{m.nom}{m.seat && m.seat !== m.nom ? ` · ${m.seat}` : ""}</option>)}
            </select></label>
          <label className="f">Nom contient<input value={f.q} onChange={(e) => set("q", e.target.value)} maxLength={100} placeholder="ex. nails" /></label>
        </div>
        <details>
          <summary className="small muted">Catégories Overture précises ({f.cats.length} choisie{f.cats.length > 1 ? "s" : ""})</summary>
          <input value={catQ} onChange={(e) => setCatQ(e.target.value)} placeholder="Filtrer : nail, dent, spa…" style={{ margin: "8px 0" }} aria-label="Filtrer les catégories" />
          <div className="chips" style={{ maxHeight: 180, overflow: "auto" }}>
            {cats.slice(0, 120).map((c) => <button key={c.c} type="button" className={f.cats.includes(c.c) ? "on" : ""}
              onClick={() => set("cats", f.cats.includes(c.c) ? f.cats.filter((x) => x !== c.c) : [...f.cats, c.c])}>{c.c} · {c.n}</button>)}
          </div>
        </details>
        <div className="chips">
          {([["tel", "📞 a un téléphone"], ["site", "🌐 a un site"], ["social", "# a un réseau"], ["email", "✉️ a un email"]] as const).map(([k, l]) =>
            <button key={k} type="button" className={f[k] ? "on" : ""} aria-pressed={f[k]} onClick={() => set(k, !f[k])}>{l}</button>)}
          <button type="button" className={f.closed ? "on" : ""} aria-pressed={f.closed} onClick={() => set("closed", !f.closed)}>exclure les fermés</button>
        </div>
        <label className="f">Confiance minimale : {Math.round(f.conf * 100)} %<input type="range" min={0} max={0.95} step={0.05} value={f.conf} onChange={(e) => set("conf", Number(e.target.value))} /></label>
        <div className="row"><button type="button" className="btn primary" disabled={busy} onClick={search}>{busy ? "Recherche…" : "Rechercher dans Overture"}</button></div>
        {msg && <p className={"small " + (msg.kind === "bad" ? "err" : msg.kind === "warn" ? "warn-text" : "muted")} style={{ margin: 0 }} role="status">{msg.text}</p>}
        <p className="tiny muted" style={{ margin: 0 }}>Données © Overture Maps Foundation (overturemaps.org), licences CDLA Permissive 2.0 et ODbL selon les sources. La « confiance » est celle d'Overture (existence du lieu).</p>
      </div>
      <DenueMap tiles={tiles} rows={rows.map((r) => ({ clee: r.sourceId, nom: r.nom, activite: r.categorie, lat: r.lat, lng: r.lng, existing: r.existing }))}
        point={null} rayon={0} picking={false} onPick={() => {}} selected={selected} attribution="© Overture Maps Foundation"
        onSelect={(c) => { setSelected(c); document.getElementById("r-" + c)?.scrollIntoView({ block: "nearest" }); }}
        onBounds={(b) => { bounds.current = b; }} />
      {rows.length > 0 && <SourceResults key={label + rows.length} rows={rows} setRows={setRows} label={label} selected={selected} onSelect={setSelected} />}
    </section>
  );
}
