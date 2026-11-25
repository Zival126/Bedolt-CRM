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
import GeoEditor from "@/components/GeoEditor";
import { tileConfig } from "@/lib/tiles";
import { precisionText, sourceLabel } from "@/lib/geo";
import { STATUTS } from "@/lib/constants";
import { requireSession } from "@/lib/session";
import { waState } from "@/lib/crm";
import { socialHref, mailto } from "@/lib/contacts";
import { safeHttpUrl } from "@/lib/phone";
import { DncToggle, DenueRefresh, EnrichNow, GoogleCheck } from "@/components/ContactActions";
import { originsOf, SOURCE_LABEL } from "@/lib/sources";
import { sourcesOf } from "@/lib/crm";
import { googleEnabled } from "@/lib/google";
import { db } from "@/lib/db";
import SourceLive from "@/components/sources/SourceLive";
import WebAuditPanel from "@/components/WebAuditPanel";
import AiPanel from "@/components/AiPanel";
import { webAudit } from "@/lib/web-audit";
import { aiOutput } from "@/lib/ai-context";
import { API_KEYS, PROVIDERS, apiEnabled } from "@/lib/places-api";
import { ContactIcons } from "@/components/BusinessList";
import { NicheBadge } from "@/components/ui";
import { nicheList } from "@/lib/niches";

export const dynamic = "force-dynamic";
const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
const FIELD_FR: Record<string, string> = { email: "Email", site_web: "Site web", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", telephone: "Téléphone",
  whatsapp: "Numéro WhatsApp", wa_confirme: "WhatsApp : oui", adresse: "Adresse", colonia: "Colonia", ville: "Ville", horaires: "Horaires", niche: "Niche", position: "Position" };
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
  const site = safeHttpUrl(b.site_web), fb = socialHref("facebook", b.facebook), ig = socialHref("instagram", b.instagram);
  const tk = /^https:\/\/(www\.)?tiktok\.com\/@[\w.]+$/i.test(b.tiktok) ? b.tiktok : "";
  const origins = originsOf(b.id);
  const ENRICH: Record<string, string> = { trouve: "informations trouvées", rien: "rien de nouveau", injoignable: "site injoignable", bloque: "site refusé (sécurité)", robots: "interdit par robots.txt" };
  const wa = waState(b);
  const lostAt = b.statut === "perdu" ? history.find((h) => h.statut === "perdu" || h.statut === "pas_interesse") : undefined;
  return (
    <>
      <div className="row spread" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}><h1>{b.nom}</h1>
          <div className="row small muted" style={{ gap: 6 }}><NicheBadge n={b.niche_id ? nicheList(true).find((n) => n.id === b.niche_id) ?? null : null} />
            {[b.niche ? "" : b.activite, b.zone, b.colonia, b.ville].filter(Boolean).join(" · ")}</div>
          {b.specialite && <p className="small" style={{ margin: "4px 0 0" }}><span className="muted">Spécialité : </span>{b.specialite}</p>}</div>
        <StatusBadge s={b.statut} motif={b.perdu_motif} />
      </div>

      {b.ne_pas_contacter ? (
        <div className="banner bad" style={{ marginTop: 12 }}>⛔ Ne pas contacter{b.dnc_at ? ` · depuis le ${fmt(b.dnc_at)}` : ""}. Exclue des files, du mode focus, de la carte (par défaut) et des envois WhatsApp.</div>
      ) : null}
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
          {b.statut !== "perdu" && !b.ne_pas_contacter && TEMPLATES.map((t) => <WaButton key={t.key} id={b.id} nom={b.nom} template={t.key} label={`WA · ${t.label}`} small disabled={!hasWa} />)}
        </div>
        <div className="row"><span className="muted small">Statut :</span><StatusSelect id={b.id} value={b.statut} /></div>
        <p className="tiny muted" style={{ margin: 0 }}>source : {b.source}{b.source_detail ? ` (${b.source_detail})` : ""}
          {b.import_batch_id ? <> · <Link href={`/commerces?vue=toutes&lot=${b.import_batch_id}`}>lot #{b.import_batch_id}</Link></> : null}</p>
      </section>

      <section className="card stack" style={{ marginTop: 10 }} aria-label="Contacts">
        <div className="row spread"><b>Contacts</b>
          <ContactIcons r={{ tel: b.tel_norm ? prettyPhone(b.telephone || b.tel_norm) : "", email: b.email, site, wa, facebook: fb, instagram: ig }} /></div>
        <div className="contact-grid small">
          <span className="muted">Téléphone</span><span>{b.tel_norm ? <a href={`tel:+52${b.tel_norm}`}>{prettyPhone(b.telephone || b.tel_norm)}</a> : b.telephone || <span className="muted">—</span>}</span>
          <span className="muted">WhatsApp</span><span className={"wa-txt-" + wa}>{wa}{wa === "non" ? " (marqué « Pas de WhatsApp »)" : wa === "oui" ? " (envoi réussi, saisie ou lien wa.me du site)" : ""}</span>
          <span className="muted">Email</span><span>{b.email ? <a href={mailto(b.email) || undefined}>{b.email}</a> : <span className="muted">—</span>}</span>
          <span className="muted">Site web</span><span>{site ? <a href={site} target="_blank" rel="noreferrer noopener">{site} ↗</a> : b.site_web || <span className="muted">—</span>}</span>
          <span className="muted">Facebook</span><span>{fb ? <a href={fb} target="_blank" rel="noreferrer noopener">{fb.replace(/^https?:\/\/(www\.)?/, "")} ↗</a> : <span className="muted">—</span>}</span>
          <span className="muted">Instagram</span><span>{ig ? <a href={ig} target="_blank" rel="noreferrer noopener">{ig.replace(/^https?:\/\/(www\.)?/, "")} ↗</a> : <span className="muted">—</span>}</span>
          {tk ? <><span className="muted">TikTok</span><span><a href={tk} target="_blank" rel="noreferrer noopener">{tk.replace(/^https?:\/\/(www\.)?/, "")} ↗</a></span></> : null}
          {b.horaires ? <><span className="muted">Horaires</span><span>{b.horaires}</span></> : null}
          <span className="muted">Sources</span><span className="row" style={{ gap: 4 }}>{sourcesOf(b).map((x) => <span key={x} className="badge">{SOURCE_LABEL[x] ?? x}</span>)}</span>
        </div>
        {b.site_web && (
          <p className="tiny muted" style={{ margin: 0 }}>{b.enrich_at ? `Enrichi le ${fmt(b.enrich_at)} : ${ENRICH[b.enrich_status] ?? b.enrich_status}.` : "Pas encore enrichi depuis le site web."}</p>
        )}
        {origins.length > 0 && (
          <details className="tiny muted"><summary>Origine des informations ({origins.length})</summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{origins.map((o) => <li key={o.field}><b>{FIELD_FR[o.field] ?? o.field}</b> : {o.value.slice(0, 80)} — {o.origin}</li>)}</ul></details>
        )}
        <div className="row">
          {mailto(b.email) && !b.ne_pas_contacter ? <a className="btn sm primary-soft" href={mailto(b.email, b.nom)}>✉️ Écrire un email</a> : null}
          <DncToggle id={b.id} on={!!b.ne_pas_contacter} />
          {b.denue_id ? <DenueRefresh id={b.id} /> : null}
          {b.site_web ? <EnrichNow id={b.id} /> : null}
          {googleEnabled() ? <GoogleCheck id={b.id} /> : null}
          {b.lat != null && b.lng != null ? <Link className="btn sm" href={`/sources/denue?mode=point&lat=${b.lat}&lng=${b.lng}`}>Chercher autour (DENUE)</Link> : null}
        </div>
        <SourceLive businessId={b.id} current={{ telephone: b.telephone, site_web: b.site_web, email: b.email, adresse: b.adresse, ville: b.ville, specialite: b.specialite }}
          providers={API_KEYS.filter((k) => b[PROVIDERS[k].idCol]).map((k) => ({ key: k, label: PROVIDERS[k].label, enabled: apiEnabled(k), attribution: PROVIDERS[k].attribution }))} />
        {b.denue_id ? <p className="tiny muted" style={{ margin: 0 }}>DENUE · CLEE {b.denue_id}{b.denue_estrato ? ` · ${b.denue_estrato}` : ""}{b.denue_alta ? ` · alta ${b.denue_alta}` : ""}{b.denue_sync ? ` · mis à jour le ${fmt(b.denue_sync)}` : ""}</p> : null}
        <p className="tiny muted" style={{ margin: 0 }}>Modifiables dans « Fiche » ci-dessous.</p>
      </section>

      <GeoEditor tiles={tileConfig()} id={b.id} lat={b.lat} lng={b.lng} precisionText={precisionText(b.lat == null ? "" : b.geo_precision)} source={sourceLabel(b.geo_source)}
        manual={b.geo_source === "manuel"} statutIndex={Math.max(0, STATUTS.findIndex((s) => s.key === (b.statut === "pas_interesse" ? "perdu" : b.statut)))} />

      <h2>Présence web</h2>
      <section className="card"><WebAuditPanel id={b.id} site={b.site_web} initial={webAudit(b.id)} /></section>

      <h2>IA</h2>
      <AiPanel id={b.id} queued={!!db.prepare("SELECT 1 FROM ai_queue WHERE business_id = ? AND done_at IS NULL").get(b.id)}
        out={(() => { const o = aiOutput(b.id); return o ? { ...o, improvements: JSON.parse(o.improvements || "[]") as string[] } : null; })()} />

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
