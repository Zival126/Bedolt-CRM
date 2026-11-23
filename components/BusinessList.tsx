"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { STATUTS, OFFRES, MOTIFS, statutLabel, ficheLabel } from "@/lib/constants";
import { OffreBadge, Stars, StatusBadge } from "./Badges";
import { bulkUpdate } from "@/app/actions";
import WaButton from "./WaButton";

export type ListRow = {
  id: number; nom: string; niche: string; zone: string; offre: string; ville: string; statut: string; fiche_google: string;
  presence_web: string; note_google: number | null; nb_avis: number | null; score: number | null; score_raison: string;
  tel: string; telHref: string; hasWa: boolean; maps: string; template: "first" | "j2" | "j7"; hasMsg: boolean; angle: string; motif: string; noWa: boolean;
};

export { OffreBadge, Stars };

export default function BusinessList({ rows, total, filterQuery }: { rows: ListRow[]; total: number; filterQuery: string }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [all, setAll] = useState(false); // « toutes les fiches du filtre » (au-delà de la page)
  const [statut, setStatut] = useState("");
  const [motif, setMotif] = useState("autre");
  const [offre, setOffre] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const [aiBusy, setAiBusy] = useState(false);
  const toggle = (id: number) => { setAll(false); setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const pageAll = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const count = all ? total : sel.size;
  const target = () => (all ? { query: filterQuery } : { ids: [...sel] });

  function apply(change: { statut?: string; offre?: string; motif?: string }, label: string) {
    if (!count) return;
    if (count > 50 && !confirm(`${label} pour ${count} fiche(s) ?`)) return;
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
            <button className="btn sm primary" disabled={aiBusy || pending} onClick={rank}>Classer avec l'IA</button>
          </div>
        </div>
      )}
      {msg && <p className="small">{msg}</p>}

      {/* Mobile : cartes */}
      <div className="list only-mob">
        {rows.map((r) => (
          <div key={r.id} className={"bcard" + (sel.has(r.id) || all ? " sel" : "")}>
            <div className="head">
              <input type="checkbox" checked={all || sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Sélectionner ${r.nom}`} style={{ marginTop: 2 }} />
              <Link href={`/commerces/${r.id}`} style={{ flex: 1, minWidth: 0, color: "inherit" }}>
                <div className="row spread" style={{ flexWrap: "nowrap" }}><span className="t">{r.nom}</span><OffreBadge o={r.offre} /></div>
                <div className="small muted">{[r.niche, r.zone, r.ville].filter(Boolean).join(" · ")}</div>
                <div className="row" style={{ marginTop: 4, gap: 6 }}>
                  <Stars note={r.note_google} avis={r.nb_avis} />
                  <StatusBadge s={r.statut} motif={r.motif} />
                  {r.noWa && <span className="badge warn">sans WhatsApp</span>}
                  {r.score != null && <span className="badge accent">{r.score}/100</span>}
                  {r.presence_web && <span className="badge">{r.presence_web}</span>}
                </div>
              </Link>
            </div>
            <div className="acts">
              {r.telHref ? <a className="btn sm primary" href={r.telHref}>Appeler</a> : <span className="btn sm off">Pas de tél.</span>}
              <WaButton id={r.id} nom={r.nom} template={r.template} label="WhatsApp" small disabled={!r.hasWa || r.statut === "perdu"} />
              <a className="btn sm" href={r.maps} target="_blank" rel="noreferrer">Maps</a>
            </div>
          </div>
        ))}
      </div>

      {/* Ordinateur : tableau compact */}
      <div className="only-desk" style={{ overflowX: "auto" }}>
        <table className="compact">
          <thead><tr><th></th><th>Commerce</th><th>Niche</th><th>Zone</th><th>Offre</th><th>Google</th><th>Statut</th><th>Tél.</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={sel.has(r.id) || all ? "sel" : ""}>
                <td><input type="checkbox" checked={all || sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Sélectionner ${r.nom}`} /></td>
                <td><Link className="t" href={`/commerces/${r.id}`}>{r.nom}</Link><div className="small muted">{[r.ville, r.presence_web].filter(Boolean).join(" · ")}{r.score != null ? ` · IA ${r.score}` : ""}{r.hasMsg ? " · 💬" : ""}</div></td>
                <td>{r.niche}</td><td>{r.zone}</td><td><OffreBadge o={r.offre} /></td>
                <td><Stars note={r.note_google} avis={r.nb_avis} /><div className="small muted">{ficheLabel(r.fiche_google)}</div></td>
                <td className="nowrap"><StatusBadge s={r.statut} motif={r.motif} />{r.noWa && <div className="small warn-text">sans WhatsApp</div>}</td>
                <td className="nowrap">{r.telHref ? <a href={r.telHref}>{r.tel}</a> : <span className="muted">—</span>}</td>
                <td className="nowrap"><span className="row" style={{ flexWrap: "nowrap", gap: 4 }}>
                  <WaButton id={r.id} nom={r.nom} template={r.template} label="WA" small disabled={!r.hasWa || r.statut === "perdu"} />
                  <a className="btn sm" href={r.maps} target="_blank" rel="noreferrer">Maps</a></span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <div className="empty">Aucune fiche ne correspond à ces filtres.</div>}
    </>
  );
}
