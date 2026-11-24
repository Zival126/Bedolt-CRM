"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { statutLabel } from "@/lib/constants";
import { mapsSearchUrl, prettyPhone } from "@/lib/phone";
import { postJson } from "../client-api";
import { toast, toastError } from "../Toast";
import { REASON, type Existing } from "../denue/types";

/** Établissement d'une source (OSM / Overture), tel que renvoyé par l'API, avec la fiche du CRM correspondante. */
export type SRow = {
  source: "osm" | "overture"; sourceId: string; nom: string; categorie: string; niche: string; telephone: string; whatsapp?: string; email: string;
  site_web: string; facebook: string; instagram: string; tiktok?: string; adresse: string; colonia: string; ville: string; lat: number | null; lng: number | null;
  horaires?: string; confidence?: number | null; closed?: boolean; existing: Existing;
};
type F = { tel: boolean; email: boolean; site: boolean; social: boolean; crm: "" | "new" | "crm"; niche: string; q: string };
const F0: F = { tel: false, email: false, site: false, social: false, crm: "", niche: "", q: "" };
const SHOW = 100;
const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

export function filterRows(rows: SRow[], f: F) {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => (!f.tel || r.telephone) && (!f.email || r.email) && (!f.site || r.site_web) && (!f.social || r.facebook || r.instagram || r.tiktok)
    && (f.crm !== "new" || !r.existing) && (f.crm !== "crm" || r.existing) && (!f.niche || (f.niche === "none" ? !r.niche : r.niche === f.niche))
    && (!q || r.nom.toLowerCase().includes(q) || r.categorie.includes(q)));
}

export default function SourceResults({ rows, setRows, label, selected, onSelect }: {
  rows: SRow[]; setRows: (fn: (r: SRow[]) => SRow[]) => void; label: string; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const [f, setF] = useState<F>(F0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [show, setShow] = useState(SHOW);
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => filterRows(rows, f), [rows, f]);
  const niches = useMemo(() => [...new Set(rows.map((r) => r.niche).filter(Boolean))].sort(), [rows]);
  const nNew = shown.filter((r) => !r.existing).length;
  const set = <K extends keyof F>(k: K, v: F[K]) => { setF((x) => ({ ...x, [k]: v })); setShow(SHOW); };
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function add(list: SRow[], merge = false) {
    const items = merge ? list : list.filter((r) => !r.existing);
    if (!items.length) return toast("Rien à ajouter : déjà dans le CRM.");
    if (items.length > 50 && !confirm(`Ajouter ${items.length} établissements en « À contacter » ?`)) return;
    setBusy(true);
    try {
      const body = { label, items: items.map(({ existing: _e, confidence: _c, closed: _x, ...c }) => ({ ...c, whatsapp: c.whatsapp ?? "", tiktok: c.tiktok ?? "", horaires: c.horaires ?? "" })) };
      const j = await postJson<{ added: number; merged: number; filled: number; ids: Record<string, number> }>("/api/sources/add", body);
      setRows((all) => all.map((x) => (j.ids[x.sourceId] ? { ...x, existing: x.existing ?? { id: j.ids[x.sourceId], statut: "a_contacter", reason: "id", dnc: false } } : x)));
      setSel(new Set());
      toast(`${j.added} ajouté(s) en « À contacter »${j.merged ? ` · ${j.merged} fusionné(s) (${j.filled} champ(s) complété(s))` : ""}.`);
    } catch (e) { toastError(e); }
    setBusy(false);
  }

  const chip = (on: boolean, l: string, fn: () => void) => <button type="button" className={on ? "on" : ""} aria-pressed={on} onClick={fn}>{l}</button>;
  const badge = (r: SRow) => r.existing ? (
    <span className="stack" style={{ gap: 4, alignItems: "flex-start" }}>
      <Link href={`/commerces/${r.existing.id}`} className="badge ok" title={REASON[r.existing.reason]} onClick={(e) => e.stopPropagation()}>Dans le CRM · {statutLabel(r.existing.statut)}{r.existing.dnc ? " ⛔" : ""}</Link>
      <button type="button" className="link tiny" disabled={busy} onClick={(e) => { e.stopPropagation(); add([r], true); }}>Compléter la fiche</button>
    </span>) : <span className="badge new-badge">nouveau</span>;
  const socials = (r: SRow) => [r.facebook && ["Facebook", r.facebook], r.instagram && ["Instagram", r.instagram], r.tiktok && ["TikTok", r.tiktok]].filter(Boolean) as [string, string][];

  return (
    <section className="stack" style={{ gap: 10 }} aria-label="Résultats">
      <div className="card stack" style={{ padding: 10, gap: 8 }}>
        <div className="row spread">
          <b>{shown.length.toLocaleString("fr-FR")} affiché(s){shown.length !== rows.length ? <span className="muted"> sur {rows.length.toLocaleString("fr-FR")}</span> : ""}</b>
          <span className="small muted">{nNew.toLocaleString("fr-FR")} nouveau(x) · {(shown.length - nNew).toLocaleString("fr-FR")} déjà dans le CRM</span>
        </div>
        <div className="chips scroll" aria-label="Filtres des résultats">
          {chip(f.tel, "📞 téléphone", () => set("tel", !f.tel))}
          {chip(f.email, "✉️ email", () => set("email", !f.email))}
          {chip(f.site, "🌐 site", () => set("site", !f.site))}
          {chip(f.social, "# réseau", () => set("social", !f.social))}
          {chip(f.crm === "new", "nouveaux seulement", () => set("crm", f.crm === "new" ? "" : "new"))}
          {chip(f.crm === "crm", "déjà dans le CRM", () => set("crm", f.crm === "crm" ? "" : "crm"))}
        </div>
        <div className="grid g2">
          <select value={f.niche} onChange={(e) => set("niche", e.target.value)} aria-label="Niche">
            <option value="">Niche : toutes</option>{niches.map((n) => <option key={n} value={n}>{n}</option>)}<option value="none">Sans niche</option></select>
          <input value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Nom contient…" aria-label="Filtrer par nom" />
        </div>
        <div className="row">
          <label className="chk small"><input type="checkbox" disabled={!nNew} checked={nNew > 0 && shown.filter((r) => !r.existing).every((r) => sel.has(r.sourceId))}
            onChange={(e) => setSel(e.target.checked ? new Set(shown.filter((r) => !r.existing).map((r) => r.sourceId)) : new Set())} />Tout cocher (nouveaux affichés)</label>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn sm" disabled={!sel.size || busy} onClick={() => add(rows.filter((r) => sel.has(r.sourceId)))}>Ajouter la sélection ({sel.size})</button>
          <button type="button" className="btn sm primary" disabled={!nNew || busy} onClick={() => add(shown)}>Ajouter tous les filtrés ({nNew.toLocaleString("fr-FR")})</button>
        </div>
      </div>

      <div className="list only-mob">
        {shown.slice(0, show).map((r) => (
          <div key={r.sourceId} id={"r-" + r.sourceId} className={"bcard denue-card" + (selected === r.sourceId ? " sel" : "")} onClick={() => onSelect(r.sourceId)}>
            <div className="head">
              {!r.existing ? <input type="checkbox" checked={sel.has(r.sourceId)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.sourceId)} aria-label={`Sélectionner ${r.nom}`} style={{ marginTop: 2 }} /> : null}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row spread" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}><span className="t">{r.nom}</span>{badge(r)}</div>
                <div className="small muted">{r.categorie}{r.niche ? ` → ${r.niche}` : ""}{r.closed ? " · fermé ?" : ""}</div>
                <div className="small">{[r.adresse, r.colonia, r.ville].filter(Boolean).join(" · ")}</div>
                <div className="small denue-contacts">
                  {r.telephone ? <a href={`tel:${r.telephone}`} onClick={(e) => e.stopPropagation()}>📞 {prettyPhone(r.telephone)}</a> : <span className="muted">📞 —</span>}
                  {r.email && <a href={`mailto:${r.email}`} onClick={(e) => e.stopPropagation()}>✉️ {r.email}</a>}
                  {r.site_web && <a href={r.site_web} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>🌐 {host(r.site_web)}</a>}
                  {socials(r).map(([l, u]) => <a key={l} href={u} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>{l}</a>)}
                </div>
                {r.confidence != null && <div className="tiny muted">confiance {Math.round(r.confidence * 100)} %</div>}
              </div>
            </div>
            {!r.existing && <div className="row">
              <a className="btn sm" target="_blank" rel="noreferrer" href={mapsSearchUrl(r.nom, r.ville)} onClick={(e) => e.stopPropagation()}>Vérifier sur Maps ↗</a>
              <button type="button" className="btn sm primary" disabled={busy} onClick={(e) => { e.stopPropagation(); add([r]); }}>Ajouter</button></div>}
          </div>
        ))}
      </div>

      <div className="only-desk" style={{ overflowX: "auto" }}>
        <table className="compact clickable denue-table">
          <thead><tr><th></th><th>Nom</th><th>Catégorie → niche</th><th>Adresse</th><th>Téléphone</th><th>Email</th><th>Site / réseaux</th><th>CRM</th></tr></thead>
          <tbody>
            {shown.slice(0, show).map((r) => (
              <tr key={r.sourceId} id={"r-" + r.sourceId} className={selected === r.sourceId ? "sel" : ""} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input")) onSelect(r.sourceId); }}>
                <td>{!r.existing && <input type="checkbox" checked={sel.has(r.sourceId)} onChange={() => toggle(r.sourceId)} aria-label={`Sélectionner ${r.nom}`} />}</td>
                <td style={{ minWidth: 160 }}><b>{r.nom}</b>{r.confidence != null && <div className="tiny muted">confiance {Math.round(r.confidence * 100)} %{r.closed ? " · fermé ?" : ""}</div>}</td>
                <td className="small act"><span>{r.categorie}</span>{r.niche && <div className="tiny ok">→ {r.niche}</div>}</td>
                <td className="small act" title={[r.adresse, r.colonia].filter(Boolean).join(" · ")}><span>{[r.adresse, r.colonia].filter(Boolean).join(" · ")}</span><div className="tiny muted">{r.ville}</div></td>
                <td className="nowrap small">{r.telephone ? <a href={`tel:${r.telephone}`}>{prettyPhone(r.telephone)}</a> : <span className="muted">—</span>}</td>
                <td className="small">{r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : <span className="muted">—</span>}</td>
                <td className="small site-cell">{r.site_web && <div className="ellipsis"><a href={r.site_web} target="_blank" rel="noreferrer noopener" title={r.site_web}>{host(r.site_web)}</a></div>}
                  <span className="row" style={{ gap: 6 }}>{socials(r).map(([l, u]) => <a key={l} href={u} target="_blank" rel="noreferrer noopener">{l}</a>)}</span>
                  {!r.site_web && !socials(r).length && <span className="muted">—</span>}</td>
                <td><div className="stack" style={{ gap: 6, alignItems: "flex-start" }}>{badge(r)}
                  {!r.existing && <button type="button" className="btn sm" disabled={busy} onClick={() => add([r])}>Ajouter</button>}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > show && <button type="button" className="btn wide" onClick={() => setShow((s) => s + 200)}>Afficher plus ({(shown.length - show).toLocaleString("fr-FR")} restants)</button>}
      {rows.length > 0 && shown.length === 0 && <div className="empty">Aucun résultat avec ces filtres.</div>}
    </section>
  );
}
