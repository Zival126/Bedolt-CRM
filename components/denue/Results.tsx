"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FICHES, INTERETS, statutLabel } from "@/lib/constants";
import { mapsSearchUrl, prettyPhone } from "@/lib/phone";
import { postJson } from "../client-api";
import { toast, toastError } from "../Toast";
import { monthsSince, REASON, STRATES, type Qual, type Row } from "./types";

type F = { tel: boolean; email: boolean; site: boolean; crm: "" | "new" | "crm"; recent: "" | "12" | "24"; strate: string; tipo: string; colonia: string };
const F0: F = { tel: false, email: false, site: false, crm: "", recent: "", strate: "", tipo: "", colonia: "" };
const SHOW = 100;
const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/** Filtres appliqués aux résultats (côté navigateur). */
export function applyFilters(rows: Row[], f: F, now = new Date()): Row[] {
  return rows.filter((r) => {
    if (f.tel && !r.telephone) return false;
    if (f.email && !r.email) return false;
    if (f.site && !r.site_web) return false;
    if (f.crm === "new" && r.existing) return false;
    if (f.crm === "crm" && !r.existing) return false;
    if (f.recent) { const m = monthsSince(r.alta, now); if (m === null || m > Number(f.recent)) return false; }
    if (f.strate && String(r.strate) !== f.strate) return false;
    if (f.tipo && r.tipo !== f.tipo) return false;
    if (f.colonia && r.colonia !== f.colonia) return false;
    return true;
  });
}

export default function Results({ rows, setRows, label, selected, onSelect, header }: {
  rows: Row[]; setRows: (fn: (r: Row[]) => Row[]) => void; label: string; selected: string | null; onSelect: (clee: string | null) => void; header?: React.ReactNode;
}) {
  const [f, setF] = useState<F>(F0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [qual, setQual] = useState<Record<string, Qual>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [show, setShow] = useState(SHOW);
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => applyFilters(rows, f), [rows, f]);
  const colonias = useMemo(() => [...new Set(rows.map((r) => r.colonia).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [rows]);
  const tipos = useMemo(() => [...new Set(rows.map((r) => r.tipo).filter(Boolean))].sort(), [rows]);
  const hasAlta = rows.some((r) => r.alta);
  const nNew = shown.filter((r) => !r.existing).length;
  const q = (r: Row) => qual[r.clee] ?? { fiche_google: "", interet: "", note: "" };
  const setQ = (r: Row, p: Partial<Qual>) => setQual((x) => ({ ...x, [r.clee]: { ...q(r), ...p } }));
  const set = <K extends keyof F>(k: K, v: F[K]) => { setF((x) => ({ ...x, [k]: v })); setShow(SHOW); };
  const toggle = (c: string) => setSel((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });

  async function add(list: Row[], merge = false) {
    const items = merge ? list : list.filter((r) => !r.existing);
    if (!items.length) return toast("Rien à ajouter : déjà dans le CRM.");
    if (items.length > 50 && !confirm(`Ajouter ${items.length} établissements en « À contacter » ?`)) return;
    setBusy(true);
    try {
      const body = { label, items: items.map((r) => ({ clee: r.clee, id: r.id, nom: r.nom, activite: r.activite, classe: r.classe, estrato: r.estrato,
        telephone: r.telephone, email: r.email, site_web: r.site_web, adresse: r.adresse, colonia: r.colonia, ville: r.ville,
        lat: r.lat, lng: r.lng, alta: r.alta, ...q(r) })) };
      const j = await postJson<{ added: number; merged: number; ids: Record<string, number> }>("/api/denue/add", body);
      setRows((all) => all.map((x) => (j.ids[x.clee] ? { ...x, existing: x.existing ?? { id: j.ids[x.clee], statut: "a_contacter", reason: "id", dnc: false } } : x)));
      setSel(new Set());
      toast(`${j.added} ajouté(s) en « À contacter »${j.merged ? ` · ${j.merged} fusionné(s) avec une fiche existante` : ""}.`);
    } catch (e) { toastError(e); }
    setBusy(false);
  }

  const chip = (on: boolean, label: string, fn: () => void) => <button type="button" className={on ? "on" : ""} aria-pressed={on} onClick={fn}>{label}</button>;
  const crmBadge = (r: Row) => r.existing
    ? <span className="stack" style={{ gap: 4, alignItems: "flex-start" }}>
        <Link href={`/commerces/${r.existing.id}`} className="badge ok" title={REASON[r.existing.reason]} onClick={(e) => e.stopPropagation()}>Dans le CRM · {statutLabel(r.existing.statut)}{r.existing.dnc ? " ⛔" : ""}</Link>
        <button type="button" className="link tiny" disabled={busy} title="Complète les champs vides de la fiche avec ceux de DENUE" onClick={(e) => { e.stopPropagation(); add([r], true); }}>Compléter la fiche</button>
      </span>
    : <span className="badge new-badge">nouveau</span>;

  const qualify = (r: Row) => (
    <div className="stack qualif" style={{ gap: 8 }} onClick={(e) => e.stopPropagation()}>
      <div className="row">
        <select value={q(r).fiche_google} onChange={(e) => setQ(r, { fiche_google: e.target.value })} style={{ flex: 1, minWidth: 130 }} aria-label="Fiche Google">
          {FICHES.map((x) => <option key={x.key} value={x.key}>{x.key ? `Fiche Google : ${x.label}` : "Fiche Google : ?"}</option>)}</select>
        <select value={q(r).interet} onChange={(e) => setQ(r, { interet: e.target.value })} style={{ flex: 1, minWidth: 110 }} aria-label="Intérêt">
          {INTERETS.map((x) => <option key={x.key} value={x.key}>{x.key ? `Intérêt : ${x.label}` : "Intérêt : ?"}</option>)}</select>
      </div>
      <input placeholder="Note courte" value={q(r).note} maxLength={2000} onChange={(e) => setQ(r, { note: e.target.value })} aria-label="Note" />
      <div className="row">
        <a className="btn sm" target="_blank" rel="noreferrer" href={mapsSearchUrl(r.nom, [r.colonia, r.ville].filter(Boolean).join(" "))}>Vérifier sur Google Maps ↗</a>
        <button type="button" className="btn sm primary" disabled={busy} onClick={() => add([r])}>Ajouter au CRM</button>
      </div>
    </div>
  );

  return (
    <section className="stack" style={{ gap: 10 }} aria-label="Résultats DENUE">
      {header}
      <div className="card stack" style={{ padding: 10, gap: 8 }}>
        <div className="row spread">
          <b>{shown.length.toLocaleString("fr-FR")} affiché(s){shown.length !== rows.length ? <span className="muted"> sur {rows.length.toLocaleString("fr-FR")}</span> : ""}</b>
          <span className="small muted">{nNew.toLocaleString("fr-FR")} nouveau(x) · {(shown.length - nNew).toLocaleString("fr-FR")} déjà dans le CRM</span>
        </div>
        <div className="chips scroll" aria-label="Filtres des résultats">
          {chip(f.tel, "📞 a un téléphone", () => set("tel", !f.tel))}
          {chip(f.email, "✉️ a un email", () => set("email", !f.email))}
          {chip(f.site, "🌐 a un site", () => set("site", !f.site))}
          {chip(f.crm === "new", "nouveaux seulement", () => set("crm", f.crm === "new" ? "" : "new"))}
          {chip(f.crm === "crm", "déjà dans le CRM", () => set("crm", f.crm === "crm" ? "" : "crm"))}
          {hasAlta && chip(f.recent === "12", "ouverts < 12 mois", () => set("recent", f.recent === "12" ? "" : "12"))}
          {hasAlta && chip(f.recent === "24", "ouverts < 24 mois", () => set("recent", f.recent === "24" ? "" : "24"))}
        </div>
        <div className="grid g3 denue-selects">
          <select value={f.strate} onChange={(e) => set("strate", e.target.value)} aria-label="Strate">{STRATES.map(([v, l]) => <option key={v} value={v}>{v ? `Strate : ${l}` : "Strate : toutes"}</option>)}</select>
          <select value={f.tipo} onChange={(e) => set("tipo", e.target.value)} aria-label="Type d'établissement"><option value="">Type : tous</option>{tipos.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <select value={f.colonia} onChange={(e) => set("colonia", e.target.value)} aria-label="Colonia"><option value="">Colonia : toutes ({colonias.length})</option>{colonias.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </div>
        {!hasAlta && rows.length > 0 && <span className="tiny muted">Date d'alta : fournie seulement par la recherche « Zone + activité ».</span>}
        <div className="row">
          <label className="chk small"><input type="checkbox" disabled={!nNew} checked={nNew > 0 && shown.filter((r) => !r.existing).every((r) => sel.has(r.clee))}
            onChange={(e) => setSel(e.target.checked ? new Set(shown.filter((r) => !r.existing).map((r) => r.clee)) : new Set())} />Tout cocher (nouveaux affichés)</label>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn sm" disabled={!sel.size || busy} onClick={() => add(rows.filter((r) => sel.has(r.clee)))}>Ajouter la sélection ({sel.size})</button>
          <button type="button" className="btn sm primary" disabled={!nNew || busy} onClick={() => add(shown)}>Ajouter tous les filtrés ({nNew.toLocaleString("fr-FR")})</button>
        </div>
      </div>

      {/* Téléphone : cartes */}
      <div className="list only-mob">
        {shown.slice(0, show).map((r) => (
          <div key={r.clee} id={"r-" + r.clee} className={"bcard denue-card" + (selected === r.clee ? " sel" : "")} onClick={() => onSelect(r.clee)}>
            <div className="head">
              {!r.existing ? <input type="checkbox" checked={sel.has(r.clee)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.clee)} aria-label={`Sélectionner ${r.nom}`} style={{ marginTop: 2 }} /> : null}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row spread" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}><span className="t">{r.nom}</span>{crmBadge(r)}</div>
                <div className="small muted">{r.activite}</div>
                <div className="small">{[r.colonia, r.ville].filter(Boolean).join(" · ")}</div>
                <div className="small denue-contacts">
                  {r.telephone ? <a href={`tel:${r.telephone}`} onClick={(e) => e.stopPropagation()}>📞 {prettyPhone(r.telephone)}</a> : <span className="muted">📞 —</span>}
                  {r.email && <a href={`mailto:${r.email}`} onClick={(e) => e.stopPropagation()}>✉️ {r.email}</a>}
                  {r.site_web && <a href={r.site_web} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>🌐 {host(r.site_web)}</a>}
                </div>
                <div className="tiny muted">{[r.estrato, r.tipo, r.alta && `alta ${r.alta}`].filter(Boolean).join(" · ")}</div>
              </div>
            </div>
            {!r.existing && (open === r.clee ? qualify(r)
              : <button type="button" className="btn sm" onClick={(e) => { e.stopPropagation(); setOpen(r.clee); }}>Qualifier / ajouter</button>)}
          </div>
        ))}
      </div>

      {/* Ordinateur : tableau */}
      <div className="only-desk" style={{ overflowX: "auto" }}>
        <table className="compact clickable denue-table">
          <thead><tr><th></th><th>Nom</th><th>Activité</th><th>Colonia</th><th>Téléphone</th><th>Email</th><th>Site</th><th>Strate</th><th>Alta</th><th>CRM</th></tr></thead>
          <tbody>
            {shown.slice(0, show).map((r) => (
              <FragmentRow key={r.clee} r={r} sel={sel.has(r.clee)} toggle={() => toggle(r.clee)} active={selected === r.clee} onSelect={() => onSelect(r.clee)}
                open={open === r.clee} setOpen={(o) => setOpen(o ? r.clee : null)} badge={crmBadge(r)} qualify={qualify} />
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > show && <button type="button" className="btn wide" onClick={() => setShow((s) => s + 200)}>Afficher plus ({(shown.length - show).toLocaleString("fr-FR")} restants)</button>}
      {rows.length > 0 && shown.length === 0 && <div className="empty">Aucun résultat avec ces filtres.</div>}
    </section>
  );
}

function FragmentRow({ r, sel, toggle, active, onSelect, open, setOpen, badge, qualify }: {
  r: Row; sel: boolean; toggle: () => void; active: boolean; onSelect: () => void; open: boolean; setOpen: (o: boolean) => void;
  badge: React.ReactNode; qualify: (r: Row) => React.ReactNode;
}) {
  return (
    <>
      <tr id={"r-" + r.clee} className={active ? "sel" : ""} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,select")) onSelect(); }}>
        <td>{!r.existing && <input type="checkbox" checked={sel} onChange={toggle} aria-label={`Sélectionner ${r.nom}`} />}</td>
        <td style={{ minWidth: 170 }}><b>{r.nom}</b>{r.raison && r.raison !== r.nom ? <div className="tiny muted">{r.raison}</div> : null}</td>
        <td className="small act" title={r.activite}><span>{r.activite}</span></td>
        <td className="small">{r.colonia}<div className="tiny muted">{r.ville}</div></td>
        <td className="nowrap small">{r.telephone ? <a href={`tel:${r.telephone}`}>{prettyPhone(r.telephone)}</a> : <span className="muted">—</span>}</td>
        <td className="small">{r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : <span className="muted">—</span>}</td>
        <td className="small">{r.site_web ? <a href={r.site_web} target="_blank" rel="noreferrer noopener">{host(r.site_web)}</a> : <span className="muted">—</span>}</td>
        <td className="small nowrap">{r.estrato.replace(" personas", "")}</td>
        <td className="small nowrap">{r.alta || "—"}</td>
        <td><div className="stack" style={{ gap: 6, alignItems: "flex-start" }}>{badge}
          {!r.existing && <button type="button" className="btn sm" onClick={() => setOpen(!open)}>{open ? "Fermer" : "Qualifier / ajouter"}</button>}</div></td>
      </tr>
      {open && !r.existing && <tr className="qualif-row"><td></td><td colSpan={9}>{qualify(r)}</td></tr>}
    </>
  );
}
