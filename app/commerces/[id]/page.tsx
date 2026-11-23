import Link from "next/link";
import { notFound } from "next/navigation";
import { getBusiness, businessActions, businessHistory, dayCounts } from "@/lib/crm";
import BusinessForm from "@/components/BusinessForm";
import StatusSelect from "@/components/StatusSelect";
import WaButton from "@/components/WaButton";
import DetailActions from "@/components/DetailActions";
import ActionForm from "@/components/ActionForm";
import { StatusBadge, OffreBadge, Stars } from "@/components/Badges";
import { addAction, removeBusiness, setEtiquette } from "@/app/actions";
import { MANUAL_ACTION_TYPES, actionLabel, statutLabel, ficheLabel, motifLabel, TZ } from "@/lib/constants";
import { mapsPlaceUrl, mapsSearchUrl, waNumber, prettyPhone } from "@/lib/phone";
import { TEMPLATES } from "@/lib/whatsapp";
import { panelItem } from "@/lib/panel";
import { stageInfo } from "@/lib/rows";
import { stageOf, STAGE_LABEL } from "@/lib/stage";
import { objectives } from "@/lib/settings";
import ConfirmButton from "@/components/ConfirmButton";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
const STEP: Record<string, string> = { first: "nouveau", j2: "relance J+2", j7: "relance J+7", fin: "sans réponse", reponse: "réponse", rappel: "rappel", etape: "étape" };

export default async function Detail({ params }: { params: Promise<{ id: string }> }) {
  await requireSession("redirect");
  const b = getBusiness(Number((await params).id));
  if (!b) notFound();
  const actions = businessActions(b.id), history = businessHistory(b.id);
  const o = objectives();
  const stage = stageOf(b);
  const hasWa = !!waNumber(b.whatsapp || b.telephone);
  const item = panelItem(b, { stage, hardLeft: o.newHard - dayCounts().newWa, hard: o.newHard });
  const info = stageInfo(b, stage);
  const lostAt = b.statut === "perdu" ? history.find((h) => h.statut === "perdu" || h.statut === "pas_interesse") : undefined;
  return (
    <>
      <div className="row spread" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}><h1>{b.nom}</h1>
          <p className="muted small" style={{ margin: 0 }}>{[b.niche || b.activite, b.zone, b.colonia, b.ville].filter(Boolean).join(" · ")}</p></div>
        <StatusBadge s={b.statut} motif={b.perdu_motif} />
      </div>

      {b.statut === "perdu" && (
        <div className="banner warn" style={{ marginTop: 12 }}>Perdue · {motifLabel(b.perdu_motif)}{lostAt ? ` · le ${fmt(lostAt.at)}` : ""}. Elle n'apparaît plus dans les files ; tu peux la réactiver.</div>
      )}

      <section className="card stack" style={{ marginTop: 14 }}>
        <div className="row spread"><b>{stage === "paye" ? "Client" : "Prochaine action"}</b>
          {stage !== "paye" && stage !== "perdu" && <span className={`stage stage-${stage}`}>{STAGE_LABEL[stage]}</span>}</div>
        {info && <p className="small muted" style={{ margin: 0 }}>{info}{b.statut === "contacte" && b.next_followup ? ` · due le ${b.next_followup}` : ""}</p>}
        {b.no_whatsapp ? <p className="small warn-text" style={{ margin: 0 }}>Numéro marqué « sans WhatsApp » : à appeler.</p> : null}
        {stage === "paye" ? <Link className="btn primary" href={`/clients/${b.id}`}>Ouvrir le suivi client →</Link> : <DetailActions item={item} />}
      </section>

      <section className="card stack" style={{ marginTop: 10 }}>
        <div className="row">
          <OffreBadge o={b.offre} />
          <Stars note={b.note_google} avis={b.nb_avis} />
          {b.presence_web && <span className="badge">Web : {b.presence_web}</span>}
          <span className="badge">Fiche Google : {ficheLabel(b.fiche_google)}</span>
          {b.tel_norm && <a className="badge link-badge" href={`tel:+52${b.tel_norm}`}>{prettyPhone(b.telephone || b.tel_norm)}</a>}
        </div>
        {b.angle && <div className="angle"><b>Angle</b>{b.angle}</div>}
        <div className="row">
          <a className="btn sm" href={mapsPlaceUrl(b)} target="_blank" rel="noreferrer">Google Maps ↗</a>
          <a className="btn sm" href={mapsSearchUrl(b.nom, b.ville)} target="_blank" rel="noreferrer">Chercher sur Maps ↗</a>
          {b.statut !== "perdu" && TEMPLATES.map((t) => <WaButton key={t.key} id={b.id} nom={b.nom} template={t.key} label={`WA · ${t.label}`} small disabled={!hasWa} />)}
        </div>
        <div className="row"><span className="muted small">Statut :</span><StatusSelect id={b.id} value={b.statut} /></div>
        <p className="tiny muted" style={{ margin: 0 }}>source : {b.source}{b.source_detail ? ` (${b.source_detail})` : ""}
          {b.import_batch_id ? <> · <Link href={`/commerces?vue=toutes&lot=${b.import_batch_id}`}>lot #{b.import_batch_id}</Link></> : null}</p>
      </section>

      <h2>Journal</h2>
      <ActionForm action={addAction} className="card stack">
        <input type="hidden" name="id" value={b.id} />
        <div className="row">
          <select name="type" style={{ flex: "1 1 120px", width: "auto" }} aria-label="Type">{MANUAL_ACTION_TYPES.map((k) => <option key={k} value={k}>{actionLabel(k)}</option>)}</select>
          <input name="content" placeholder="Détail (optionnel)" maxLength={5000} style={{ flex: "3 1 200px", width: "auto" }} />
          <button className="btn">Ajouter</button>
        </div>
      </ActionForm>
      <div className="list" style={{ marginTop: 8 }}>
        {actions.length === 0 && <div className="empty">Aucune action pour l'instant.</div>}
        {actions.map((a) => (
          <div key={a.id} className="item"><div className="row spread"><b>{actionLabel(a.type)}</b><span className="muted small">{fmt(a.at)}{a.step ? ` · ${STEP[a.step] ?? a.step}` : ""}</span></div>{a.content && <div className="s">{a.content}</div>}</div>
        ))}
      </div>

      <h2>Historique des statuts</h2>
      <div className="card small stack" style={{ gap: 4 }}>{history.map((h) => <div key={h.id}><span className="muted">{fmt(h.at)}</span> — {statutLabel(h.statut)}{h.motif ? ` (${motifLabel(h.motif)})` : ""}</div>)}</div>

      {b.message_whatsapp && <><h2>Message WhatsApp personnalisé</h2><div className="card small" style={{ whiteSpace: "pre-wrap" }}>{b.message_whatsapp}</div></>}

      <h2>Score IA / étiquette</h2>
      <ActionForm action={setEtiquette} className="card" submit="Enregistrer" submitClass="btn">
        <input type="hidden" name="id" value={b.id} />
        <div className="grid gform">
          <label className="f">Score (0-100)<input name="score" type="number" min={0} max={100} defaultValue={b.score ?? ""} /></label>
          <label className="f">Étiquette<input name="etiquette" defaultValue={b.etiquette} /></label>
          <label className="f full">Raison<input name="score_raison" defaultValue={b.score_raison} /></label>
        </div>
      </ActionForm>

      <h2>Fiche</h2>
      <BusinessForm b={b} />
      <ActionForm action={removeBusiness} className="" >
        <input type="hidden" name="id" value={b.id} />
        <div style={{ marginTop: 16 }}><ConfirmButton className="btn danger" message="Supprimer définitivement ce commerce ?">Supprimer ce commerce</ConfirmButton></div>
      </ActionForm>
    </>
  );
}
