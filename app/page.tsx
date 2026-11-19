import Link from "next/link";
import { dayCounts, todayLists, weekStats } from "@/lib/crm";
import { Counter, BusinessItem } from "@/components/Bits";
import WaButton from "@/components/WaButton";
import { suggestedTemplate } from "@/lib/whatsapp";
import { DAILY_WHATSAPP } from "@/lib/constants";
import { waNumber } from "@/lib/phone";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Today() {
  await requireSession("redirect");
  const c = dayCounts();
  const { followups, toCall } = todayLists();
  const w = weekStats();
  const limit = c.whatsapp >= DAILY_WHATSAPP;
  return (
    <>
      <h1>Aujourd'hui</h1>
      <div className="grid g3">
        <Counter label="Appels" n={c.calls} goal={c.callsGoal} />
        <Counter label="WhatsApp" n={c.whatsapp} max={c.whatsappMax} />
        <div className="card counter"><div className="n">{w.contacte}</div><div className="l">contactés cette semaine</div></div>
      </div>
      {limit && <div className="banner bad" style={{ marginTop: 10 }}>Limite de {DAILY_WHATSAPP} WhatsApp atteinte — le bouton est bloqué jusqu'à demain.</div>}

      <h2>Relances du jour ({followups.length})</h2>
      <div className="list">
        {followups.length === 0 && <p className="muted small">Aucune relance à faire.</p>}
        {followups.map((b) => (
          <div key={b.id} className="stack">
            <BusinessItem b={b} extra={<span className="badge warn">relance prévue {b.next_followup}</span>} />
            <div className="row">
              <WaButton id={b.id} template={suggestedTemplate(b)} label="Relancer WhatsApp" limitReached={limit} disabled={!waNumber(b.whatsapp || b.telephone)} small />
              {b.tel_norm && <a className="btn sm" href={`tel:+52${b.tel_norm}`}>Appeler</a>}
            </div>
          </div>
        ))}
      </div>

      <h2>À appeler ({toCall.length})</h2>
      <div className="list">
        {toCall.length === 0 && <p className="muted small">Personne en attente. <Link href="/denue">Cherche des commerces</Link> ou <Link href="/import">importe un fichier</Link>.</p>}
        {toCall.map((b) => (
          <div key={b.id} className="stack">
            <BusinessItem b={b} />
            <div className="row">
              <a className="btn sm primary" href={`tel:+52${b.tel_norm}`}>Appeler</a>
              <WaButton id={b.id} template="first" label="Premier message" limitReached={limit} disabled={!waNumber(b.whatsapp || b.telephone)} small />
            </div>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 14 }}>Après un appel, ouvre la fiche pour journaliser « répondu / pas répondu ».</p>
    </>
  );
}
