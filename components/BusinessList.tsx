"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { STATUTS, OFFRES, MOTIFS, statutLabel, ficheLabel } from "@/lib/constants";
import { COLUMNS, type ColumnKey } from "@/lib/columns";
import { OffreBadge, Stars, StatusBadge } from "./Badges";
import { bulkUpdate } from "@/app/actions";
import WaButton from "./WaButton";

export type ListRow = {
  id: number; nom: string; niche: string; zone: string; offre: string; ville: string; statut: string; fiche_google: string;
  presence_web: string; note_google: number | null; nb_avis: number | null; score: number | null; score_raison: string;
  tel: string; telHref: string; hasWa: boolean; maps: string; template: "first" | "j2" | "j7"; hasMsg: boolean; angle: string; motif: string; noWa: boolean;
  email: string; site: string; facebook: string; instagram: string; wa: "oui" | "non" | "inconnu"; source: string; colonia: string;
  etiquette: string; ajout: string; dnc: boolean; hasPos: boolean;
};
export type SortLink = { href: string; active: boolean; inv: boolean };

export { OffreBadge, Stars };

const WA_LABEL = { oui: "WhatsApp oui", non: "sans WhatsApp", inconnu: "WhatsApp inconnu" } as const;

/** Indicateurs de complétude : 📞 ✉️ 🌐 WhatsApp (estompés quand absents). */
export function ContactIcons({ r }: { r: Pick<ListRow, "tel" | "email" | "site" | "wa" | "facebook" | "instagram"> }) {
  return (
    <span className="cicons" aria-label="Contacts">
      <i className={r.tel ? "on" : ""} title={r.tel ? `Téléphone : ${r.tel}` : "Pas de téléphone"}>📞</i>
      <i className={r.email ? "on" : ""} title={r.email || "Pas d'email"}>✉️</i>
      <i className={r.site ? "on" : ""} title={r.site || "Pas de site"}>🌐</i>
      <i className={"wa-" + r.wa} title={WA_LABEL[r.wa]}>WA</i>
      {(r.facebook || r.instagram) && <i className="on" title={[r.facebook, r.instagram].filter(Boolean).join(" · ")}>#</i>}
    </span>
  );
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export default function BusinessList({ rows, total, filterQuery, columns, sorts }: {
  rows: ListRow[]; total: number; filterQuery: string; columns: ColumnKey[]; sorts: Partial<Record<ColumnKey, SortLink>>;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [all, setAll] = useState(false); // « toutes les fiches du filtre » (au-delà de la page)
  const [statut, setStatut] = useState("");
  const [motif, setMotif] = useState("autre");
  const [offre, setOffre] = useState("");
  const [tag, setTag] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const [aiBusy, setAiBusy] = useState(false);
  const toggle = (id: number) => { setAll(false); setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const pageAll = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const count = all ? total : sel.size;
  const target = () => (all ? { query: filterQuery } : { ids: [...sel] });

  function apply(change: { statut?: string; offre?: string; motif?: string; tag?: string; dnc?: boolean }, label: string) {
    if (!count) return;
    if ((count > 50 || change.dnc) && !confirm(`${label} pour ${count} fiche(s) ?`)) return;
    start(async () => {
      const r = await bulkUpdate({ ...target(), ...change });
      setMsg(r.error ? "⚠️ " + r.error : `✓ ${r.changed} fiche(s) modifiée(s).`);
      setSel(new Set()); setAll(false); router.refresh();
    });
  }
  async function rank() {
    let ids = [...sel];
    if (all) {
      const r = await bulkUpdate({ query: filterQuery, idsOnly: true });
      if (r.error || !r.ids) return setMsg("⚠️ " + (r.error ?? "erreur"));
      ids = r.ids.slice(0, 1000);
      if (r.ids.length > 1000 && !confirm(`Le classement IA est limité à 1 000 fiches : les 1 000 premières du tri actuel seront classées. Continuer ?`)) return;
    }
    setAiBusy(true); setMsg(`Classement IA en cours (${ids.length} fiche(s))…`);
    const r = await fetch("/api/ai/rank", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `${j.done}/${j.total} commerces classés.` : `⚠️ ${j.error} (${j.done ?? 0} classés)`);
    setAiBusy(false); router.refresh();
  }

  const cell = (r: ListRow, k: ColumnKey) => {
    switch (k) {
      case "nom": return <><Link className="t" href={`/commerces/${r.id}`}>{r.nom}</Link>
        <div className="small muted">{[r.presence_web, r.hasMsg ? "💬" : ""].filter(Boolean).join(" · ")}{r.dnc && <span className="badge bad" style={{ marginLeft: 4 }}>ne pas contacter</span>}</div></>;
      case "contacts": return <ContactIcons r={r} />;
      case "niche": return r.niche;
      case "zone": return r.zone;
      case "ville": return r.ville;
      case "colonia": return r.colonia;
      case "offre": return <OffreBadge o={r.offre} />;
      case "google": return <><Stars note={r.note_google} avis={r.nb_avis} /><div className="small muted">{ficheLabel(r.fiche_google)}</div></>;
      case "statut": return <span className="nowrap"><StatusBadge s={r.statut} motif={r.motif} />{r.noWa && <div className="small warn-text">sans WhatsApp</div>}</span>;
      case "tel": return r.telHref ? <a className="nowrap" href={r.telHref} onClick={(e) => e.stopPropagation()}>{r.tel}</a> : <span className="muted">—</span>;
      case "wa": return <span className={"small wa-txt-" + r.wa}>{r.wa}</span>;
      case "email": return r.email ? <a href={`mailto:${r.email}`} onClick={(e) => e.stopPropagation()}>{r.email}</a> : <span className="muted">—</span>;
      case "site": return r.site ? <a href={r.site} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>{host(r.site)} ↗</a> : <span className="muted">—</span>;
      case "reseaux": return <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        {r.facebook && <a href={r.facebook} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>Facebook</a>}
        {r.instagram && <a href={r.instagram} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>Instagram</a>}
        {!r.facebook && !r.instagram && <span className="muted">—</span>}</span>;
      case "source": return r.source;
      case "etiquette": return r.etiquette;
      case "score": return r.score != null ? <span className="badge accent" title={r.score_raison}>{r.score}</span> : "";
      case "ajout": return <span className="nowrap small">{r.ajout}</span>;
      case "actions": return <span className="row" style={{ flexWrap: "nowrap", gap: 4 }} onClick={(e) => e.stopPropagation()}>
        <WaButton id={r.id} nom={r.nom} template={r.template} label="WA" small disabled={!r.hasWa || r.statut === "perdu" || r.dnc} />
        <a className="btn sm" href={r.maps} target="_blank" rel="noreferrer">Maps</a></span>;
    }
  };

  return (
    <>
      <div className="row spread" style={{ margin: "8px 0" }}>
        <label className="chk small"><input type="checkbox" checked={pageAll} onChange={() => { setAll(false); setSel(pageAll ? new Set() : new Set(rows.map((r) => r.id))); }} />Sélectionner la page</label>
        {pageAll && total > rows.length && !all && <button className="btn sm" onClick={() => setAll(true)}>Sélectionner les {total.toLocaleString("fr-FR")} fiches du filtre</button>}
      </div>
      {count > 0 && (
        <div className="bulk stack">
          <div className="row spread"><b className="small">{count.toLocaleString("fr-FR")} sélectionnée(s){all ? " (tout le filtre)" : ""}</b>
            <button className="btn sm" onClick={() => { setSel(new Set()); setAll(false); }}>Désélectionner</button></div>
          <div className="row">
            <select value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Nouveau statut"><option value="">Statut…</option>{STATUTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            {statut === "perdu" && <select value={motif} onChange={(e) => setMotif(e.target.value)} aria-label="Motif">{MOTIFS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>}
            <button className="btn sm" disabled={!statut || pending} onClick={() => apply(statut === "perdu" ? { statut, motif } : { statut }, `Passer en « ${statutLabel(statut)} »`)}>Changer le statut</button>
            <input list="offres" value={offre} maxLength={20} onChange={(e) => setOffre(e.target.value)} placeholder="Offre (P1…)" style={{ width: 110 }} aria-label="Nouvelle offre" />
            <datalist id="offres">{OFFRES.map((o) => <option key={o} value={o} />)}</datalist>
            <button className="btn sm" disabled={pending} onClick={() => apply({ offre: offre.trim() }, offre.trim() ? `Offre « ${offre.trim()} »` : "Retirer l'offre")}>Changer l'offre</button>
            <input value={tag} maxLength={60} onChange={(e) => setTag(e.target.value)} placeholder="Étiquette" style={{ width: 120 }} aria-label="Étiquette à ajouter" />
            <button className="btn sm" disabled={pending || !tag.trim()} onClick={() => apply({ tag: tag.trim() }, `Ajouter l'étiquette « ${tag.trim()} »`)}>Ajouter une étiquette</button>
            <button className="btn sm danger" disabled={pending} onClick={() => apply({ dnc: true }, "Marquer « Ne pas contacter »")}>⛔ Ne pas contacter</button>
            <button className="btn sm ghost" disabled={pending} onClick={() => apply({ dnc: false }, "Retirer « Ne pas contacter »")}>Retirer ⛔</button>
            <button className="btn sm primary" disabled={aiBusy || pending} onClick={rank}>Classer avec l'IA</button>
          </div>
        </div>
      )}
      {msg && <p className="small">{msg}</p>}

      {/* Mobile : cartes */}
      <div className="list only-mob">
        {rows.map((r) => (
          <div key={r.id} className={"bcard" + (sel.has(r.id) || all ? " sel" : "") + (r.dnc ? " dnc" : "")}>
            <div className="head">
              <input type="checkbox" checked={all || sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Sélectionner ${r.nom}`} style={{ marginTop: 2 }} />
              <Link href={`/commerces/${r.id}`} style={{ flex: 1, minWidth: 0, color: "inherit" }}>
                <div className="row spread" style={{ flexWrap: "nowrap" }}><span className="t">{r.nom}</span><OffreBadge o={r.offre} /></div>
                <div className="small muted">{[r.niche, r.zone, r.ville].filter(Boolean).join(" · ")}</div>
                <div className="row" style={{ marginTop: 4, gap: 6 }}>
                  <ContactIcons r={r} />
                  <Stars note={r.note_google} avis={r.nb_avis} />
                  <StatusBadge s={r.statut} motif={r.motif} />
                  {r.dnc && <span className="badge bad">ne pas contacter</span>}
                  {r.score != null && <span className="badge accent">{r.score}/100</span>}
                  {r.presence_web && <span className="badge">{r.presence_web}</span>}
                </div>
              </Link>
            </div>
            <div className="acts">
              {r.telHref && !r.dnc ? <a className="btn sm primary" href={r.telHref}>Appeler</a> : <span className="btn sm off">{r.dnc ? "⛔" : "Pas de tél."}</span>}
              <WaButton id={r.id} nom={r.nom} template={r.template} label="WhatsApp" small disabled={!r.hasWa || r.statut === "perdu" || r.dnc} />
              {r.email && !r.dnc ? <a className="btn sm" href={`mailto:${r.email}`}>Email</a> : <a className="btn sm" href={r.maps} target="_blank" rel="noreferrer">Maps</a>}
            </div>
          </div>
        ))}
      </div>

      {/* Ordinateur : tableau compact, colonnes au choix, tri par colonne, ligne cliquable */}
      <div className="only-desk" style={{ overflowX: "auto" }}>
        <table className="compact clickable">
          <thead><tr><th></th>{columns.map((k) => {
            const s = sorts[k];
            const label = COLUMNS.find((c) => c.key === k)!.label;
            return <th key={k} aria-sort={s?.active ? (s.inv ? "descending" : "ascending") : undefined}>
              {s ? <Link href={s.href} scroll={false} className={"sorth" + (s.active ? " on" : "")}>{label}{s.active ? (s.inv ? " ▲" : " ▼") : ""}</Link> : label}</th>;
          })}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={(sel.has(r.id) || all ? "sel" : "") + (r.dnc ? " dnc" : "")}
                onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,select,label")) router.push(`/commerces/${r.id}`); }}>
                <td><input type="checkbox" checked={all || sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Sélectionner ${r.nom}`} /></td>
                {columns.map((k) => <td key={k}>{cell(r, k)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <div className="empty">Aucune fiche ne correspond à ces filtres.</div>}
    </>
  );
}
