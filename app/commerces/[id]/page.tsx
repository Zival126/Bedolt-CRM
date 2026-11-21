import Link from "next/link";
import { notFound } from "next/navigation";
import { getBusiness, businessActions, businessHistory, dayCounts } from "@/lib/crm";
import BusinessForm from "@/components/BusinessForm";
import StatusSelect from "@/components/StatusSelect";
import WaButton from "@/components/WaButton";
import { StatusBadge } from "@/components/Bits";
import { addAction, removeBusiness, setEtiquette } from "@/app/actions";
import { ACTION_TYPES, actionLabel, statutLabel, ficheLabel, DAILY_WHATSAPP } from "@/lib/constants";
import { mapsPlaceUrl, mapsSearchUrl, waNumber, prettyPhone } from "@/lib/phone";
import { TEMPLATES, suggestedTemplate } from "@/lib/whatsapp";
import { OffreBadge, Stars } from "@/components/BusinessList";
import { TZ } from "@/lib/constants";
import ConfirmButton from "@/components/ConfirmButton";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });

export default async function Detail({ params }: { params: Promise<{ id: string }> }) {
  await requireSession("redirect");
  const b = getBusiness(Number((await params).id));
  if (!b) notFound();
  const actions = businessActions(b.id), history = businessHistory(b.id);
  const limit = dayCounts().whatsapp >= DAILY_WHATSAPP;
  const hasWa = !!waNumber(b.whatsapp || b.telephone);
  return (
    <>
      <div className="row spread"><h1 style={{ margin: 0 }}>{b.nom}</h1><StatusBadge s={b.statut} /></div>
      <p className="muted small">{[b.niche || b.activite, b.zone, b.colonia, b.ville].filter(Boolean).join(" · ")} · source : {b.source}{b.source_detail ? ` (${b.source_detail})` : ""}
        {b.import_batch_id ? <> · <Link href={`/commerces?vue=toutes&lot=${b.import_batch_id}`}>lot #{b.import_batch_id}</Link></> : null}</p>

      <div className="card stack">
        <div className="row">
          <OffreBadge o={b.offre} />
          <Stars note={b.note_google} avis={b.nb_avis} />
          {b.niche && <span className="badge">{b.niche}</span>}
          {b.zone && <span className="badge">Zone : {b.zone}</span>}
          {b.presence_web && <span className="badge">Web : {b.presence_web}</span>}
          <span className="badge">Fiche Google : {ficheLabel(b.fiche_google)}</span>
        </div>
        {b.angle && <div className="angle"><b>Angle :</b> {b.angle}</div>}
        {b.message_whatsapp && <details><summary className="small">💬 Message WhatsApp personnalisé</summary><p className="small" style={{ whiteSpace: "pre-wrap" }}>{b.message_whatsapp}</p></details>}
      </div>

      <div className="card stack" style={{ marginTop: 10 }}>
        <div className="row">
          {b.tel_norm && <a className="btn primary" href={`tel:+52${b.tel_norm}`}>Appeler {prettyPhone(b.telephone || b.tel_norm)}</a>}
          <WaButton id={b.id} template={suggestedTemplate(b)} label={`WhatsApp · ${TEMPLATES.find((t) => t.key === suggestedTemplate(b))!.label}${suggestedTemplate(b) === "first" && b.message_whatsapp ? " 💬" : ""}`} disabled={!hasWa} limitReached={limit} />
          <a className="btn" href={mapsPlaceUrl(b)} target="_blank" rel="noreferrer">Google Maps</a>
          <a className="btn" href={mapsSearchUrl(b.nom, b.ville)} target="_blank" rel="noreferrer">Chercher sur Maps</a>
        </div>
        <div className="row">
          {TEMPLATES.map((t) => <WaButton key={t.key} id={b.id} template={t.key} label={t.label} small disabled={!hasWa} limitReached={limit} />)}
        </div>
        <div className="row"><span className="muted small">Statut :</span><StatusSelect id={b.id} value={b.statut} />
          {b.next_followup && <span className="badge warn">prochaine relance : {b.next_followup}</span>}
        </div>
        {b.statut === "paye" && <Link className="btn" href={`/clients/${b.id}`}>Ouvrir le suivi client →</Link>}
      </div>

      <h2>Journal</h2>
      <form action={addAction} className="card stack">
        <input type="hidden" name="id" value={b.id} />
        <div className="row">
          <select name="type" style={{ flex: 1 }}>{ACTION_TYPES.filter((a) => a.key !== "whatsapp").map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
          <input name="content" placeholder="Détail (optionnel)" style={{ flex: 2 }} />
          <button className="btn">Ajouter</button>
        </div>
      </form>
      <div className="list" style={{ marginTop: 8 }}>
        {actions.length === 0 && <p className="muted small">Aucune action.</p>}
        {actions.map((a) => (
          <div key={a.id} className="item"><div className="row spread"><b>{actionLabel(a.type)}</b><span className="muted small">{fmt(a.at)}</span></div>{a.content && <div className="s">{a.content}</div>}</div>
        ))}
      </div>

      <h2>Historique des statuts</h2>
      <div className="card small">{history.map((h) => <div key={h.id}>{fmt(h.at)} — {statutLabel(h.statut)}</div>)}</div>

      <h2>Score IA / étiquette</h2>
      <form action={setEtiquette} className="card grid gform">
        <input type="hidden" name="id" value={b.id} />
        <label className="f">Score (0-100)<input name="score" type="number" min={0} max={100} defaultValue={b.score ?? ""} /></label>
        <label className="f">Étiquette<input name="etiquette" defaultValue={b.etiquette} /></label>
        <label className="f full">Raison<input name="score_raison" defaultValue={b.score_raison} /></label>
        <button className="btn">Enregistrer</button>
      </form>

      <h2>Fiche</h2>
      <BusinessForm b={b} />
      <form action={removeBusiness} style={{ marginTop: 16 }}><input type="hidden" name="id" value={b.id} />
        <ConfirmButton className="btn danger" message="Supprimer définitivement ce commerce ?">Supprimer ce commerce</ConfirmButton></form>
    </>
  );
}
