import { todayQueue } from "@/lib/queue";
import { queueRow } from "@/lib/rows";
import { db } from "@/lib/db";
import { distinct, sourceKeys } from "@/lib/crm";
import { nicheList } from "@/lib/niches";
import { matchingNew } from "@/lib/queue-count";
import { objectives } from "@/lib/settings";
import TodayView from "@/components/TodayView";
import { requireSession } from "@/lib/session";
import { totalNew } from "@/lib/denue-watch";

export const dynamic = "force-dynamic";

// Accueil = file du jour (générée selon Réglages > Ma prospection, ou le filtre « Ma journée » du jour ; fuseau America/Cancun).
export default async function Today() {
  await requireSession("redirect");
  const q = todayQueue();
  const opts = { hardLeft: q.hardLeft, hard: q.o.newHard };
  const view = (k: keyof typeof q.blocks) => ({
    ...q.blocks[k],
    items: q.blocks[k].items.map((i) => queueRow(i.qid, i.b, i.stage, opts)),
    extra: q.blocks[k].extra.map((i) => queueRow(i.qid, i.b, i.stage, opts)),
  });
  const toCall = (db.prepare("SELECT COUNT(*) n FROM businesses WHERE no_whatsapp=1 AND tel_norm!='' AND statut NOT IN ('perdu','paye') AND ne_pas_contacter=0").get() as { n: number }).n;
  const toContact = (db.prepare("SELECT COUNT(*) n FROM businesses WHERE statut='a_contacter'").get() as { n: number }).n;
  // Prospects joignables par niche (puces de « Ma journée »)
  const ready = Object.fromEntries((db.prepare(`SELECT COALESCE(niche_id, 0) id, COUNT(*) n FROM businesses
    WHERE statut='a_contacter' AND no_whatsapp=0 AND tel_norm!='' AND ne_pas_contacter=0 GROUP BY COALESCE(niche_id, 0)`).all() as { id: number; n: number }[]).map((r) => [r.id, r.n]));
  const n = q.blocks.nouveaux;
  return (
    <TodayView day={q.day} counts={q.counts} goals={{ newGoal: q.o.newGoal, newHard: q.o.newHard, relances: q.o.relances }}
      blocks={{ reponses: view("reponses"), relances: view("relances"), nouveaux: view("nouveaux") }} toCall={toCall} toContact={toContact} denueNew={totalNew()}
      niches={nicheList(false)} allNiches={nicheList(true)}
      plan={{
        filter: q.o.filter, isDay: q.o.dayFilter, relances: q.o.filterRelances, defaultFilter: objectives().filter, matching: matchingNew(q.o), ready,
        options: { villes: distinct("ville"), zones: distinct("zone"), offres: distinct("offre"), sources: sourceKeys() },
        picked: n.items.length + n.extra.length, hardLeft: q.hardLeft, hard: q.o.newHard,
      }} />
  );
}
