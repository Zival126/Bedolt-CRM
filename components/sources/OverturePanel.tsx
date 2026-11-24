"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { postJson } from "../client-api";
import SourceResults, { type SRow } from "./SourceResults";
import NicheChips from "../NicheChips";
import { Step } from "../SourceHead";
import type { Bounds } from "../denue/DenueMap";
import type { TileConfig } from "@/lib/tiles";
import type { NicheLite } from "@/lib/niche-style";

const DenueMap = dynamic(() => import("../denue/DenueMap"), { ssr: false, loading: () => <div className="denue-map-wrap"><div className="denue-map skel" /></div> });
type Muni = { code: string; nom: string; seat: string };

// Overture Maps : recherche dans la copie locale (Quintana Roo), aucune requête réseau à la recherche.
export default function OverturePanel({ meta, count, categories, niches, municipios, tiles }: {
  meta: Record<string, string>; count: number; categories: { c: string; n: number }[]; niches: NicheLite[]; municipios: Muni[]; tiles: TileConfig;
}) {
  const [ids, setIds] = useState<number[]>(niches[0] ? [niches[0].id] : []);
  const [f, setF] = useState({ cats: [] as string[], zone: "005", q: "", tel: false, site: false, social: false, email: false, conf: 0.5, closed: true });
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
      <b>Pas encore de données Overture</b>
      <p className="small muted" style={{ margin: 0 }}>Il faut lancer une première synchronisation sur le serveur (téléchargement de la zone Quintana Roo uniquement, environ 50-60 Mo temporaires, quelques minutes) :</p>
      <pre className="code-block">runuser -u bedoltcrm -- bash /var/www/bedolt-crm/scripts/overture-sync.sh</pre>
      <p className="tiny muted" style={{ margin: 0 }}>Ensuite, la mise à jour se fait automatiquement chaque mois.</p>
    </div>
  );

  const names = niches.filter((n) => ids.includes(n.id)).map((n) => n.label);
  async function search() {
    if (!names.length && !f.cats.length && !f.q.trim()) return setMsg({ kind: "warn", text: "Choisis au moins une niche (ou une catégorie / un nom dans les options avancées)." });
    setBusy(true); setMsg(null); setSelected(null);
    try {
      const zone = f.zone === "carte" ? { bbox: bounds.current ?? undefined } : f.zone ? { municipio: f.zone } : {};
      const r = await postJson<{ rows: SRow[]; total: number }>("/api/sources/overture", {
        categories: f.cats, niches: names, q: f.q.trim() || undefined, ...zone,
        tel: f.tel || undefined, site: f.site || undefined, social: f.social || undefined, email: f.email || undefined, minConfidence: f.conf || undefined, excludeClosed: f.closed,
      });
      setRows(r.rows);
      setLabel(`Overture ${[...names, ...f.cats].join(", ")} · ${f.zone === "carte" ? "zone de la carte" : municipios.find((m) => m.code === f.zone)?.nom ?? "Quintana Roo"}`);
      setMsg({ kind: "", text: r.total ? `${r.total.toLocaleString("fr-FR")} lieu(x) trouvé(s)${r.total > r.rows.length ? ` · ${r.rows.length} affichés (les plus fiables)` : ""}.` : "Aucun lieu avec ces critères : élargis la zone ou retire un filtre." });
    } catch (e) { setMsg({ kind: "bad", text: (e as Error).message }); }
    setBusy(false);
  }
  const cats = categories.filter((c) => !catQ || c.c.includes(catQ.toLowerCase().replace(/\s+/g, "_")));
  const chip = (k: "tel" | "site" | "social" | "email" | "closed", l: string) => <button key={k} type="button" className={"sm" + (f[k] ? " on" : "")} aria-pressed={f[k]} onClick={() => set(k, !f[k])}>{l}</button>;

  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="card stack" style={{ gap: 18 }}>
        <Step n={1} title="Où" hint="Quintana Roo seulement">
          <select value={f.zone} onChange={(e) => set("zone", e.target.value)} aria-label="Zone" style={{ maxWidth: 420 }}>
            {municipios.map((m) => <option key={m.code} value={m.code}>{m.nom}{m.seat && m.seat !== m.nom ? ` · ${m.seat}` : ""}</option>)}
            <option value="">Tout le Quintana Roo</option><option value="carte">Zone visible de la carte ci-dessous</option>
          </select>
        </Step>
        <Step n={2} title="Quoi" hint="niches à chercher">
          <NicheChips niches={niches} value={ids} onChange={setIds} clearLabel="Tout décocher" />
        </Step>
        <Step n={3} title="Filtres">
          <div className="ms">{chip("tel", "A un téléphone")}{chip("social", "A un réseau social")}{chip("site", "A un site")}{chip("email", "A un email")}{chip("closed", "Sans les lieux fermés")}</div>
          <details>
            <summary className="small muted">Options avancées : fiabilité, nom, catégories précises</summary>
            <div className="stack" style={{ gap: 10, marginTop: 8 }}>
              <label className="f">Fiabilité minimale (selon Overture) : {Math.round(f.conf * 100)} %<input type="range" min={0} max={0.95} step={0.05} value={f.conf} onChange={(e) => set("conf", Number(e.target.value))} /></label>
              <label className="f">Nom contient<input value={f.q} onChange={(e) => set("q", e.target.value)} maxLength={100} placeholder="ex. nails" /></label>
              <input value={catQ} onChange={(e) => setCatQ(e.target.value)} placeholder="Filtrer les catégories : nail, dent, spa…" aria-label="Filtrer les catégories" />
              <div className="chips" style={{ maxHeight: 180, overflow: "auto" }}>
                {cats.slice(0, 120).map((c) => <button key={c.c} type="button" className={f.cats.includes(c.c) ? "on" : ""} aria-pressed={f.cats.includes(c.c)}
                  onClick={() => set("cats", f.cats.includes(c.c) ? f.cats.filter((x) => x !== c.c) : [...f.cats, c.c])}>{c.c} · {c.n}</button>)}
              </div>
            </div>
          </details>
        </Step>
        <div className="stack" style={{ gap: 8 }}>
          <p className="step-t"><span className="step-n">4</span>Chercher</p>
          <div className="row"><button type="button" className="btn primary" disabled={busy} onClick={search}>{busy ? "Recherche…" : "Chercher dans Overture"}</button></div>
          {msg && <p className={msg.kind === "bad" ? "banner bad" : msg.kind === "warn" ? "banner warn" : "small muted"} style={{ margin: 0 }} role="status">{msg.text}</p>}
          <p className="tiny muted" style={{ margin: 0 }}>Copie locale du {meta.loaded_at ? new Date(meta.loaded_at).toLocaleDateString("fr-FR") : "?"} (version {meta.release ?? "?"}, {count.toLocaleString("fr-FR")} lieux). Données © Overture Maps Foundation, licences CDLA Permissive 2.0 et ODbL.</p>
        </div>
      </div>
      <DenueMap tiles={tiles} rows={rows.map((r) => ({ clee: r.sourceId, nom: r.nom, activite: r.categorie, lat: r.lat, lng: r.lng, existing: r.existing }))}
        point={null} rayon={0} picking={false} onPick={() => {}} selected={selected} attribution="© Overture Maps Foundation"
        onSelect={(c) => { setSelected(c); document.getElementById("r-" + c)?.scrollIntoView({ block: "nearest" }); }}
        onBounds={(b) => { bounds.current = b; }} />
      {rows.length > 0 && <SourceResults key={label + rows.length} rows={rows} setRows={setRows} label={label} selected={selected} onSelect={setSelected} niches={niches} />}
    </section>
  );
}
