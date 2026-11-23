import { todayQueue } from "@/lib/queue";
import { queueRow } from "@/lib/rows";
import { db } from "@/lib/db";
import TodayView from "@/components/TodayView";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Accueil = file du jour (générée selon Réglages > Objectifs, stable dans la journée, fuseau America/Cancun).
export default async function Today() {
  await requireSession("redirect");
  const q = todayQueue();
  const opts = { hardLeft: q.hardLeft, hard: q.o.newHard };
  const view = (k: keyof typeof q.blocks) => ({
    ...q.blocks[k],
    items: q.blocks[k].items.map((i) => queueRow(i.qid, i.b, i.stage, opts)),
    extra: q.blocks[k].extra.map((i) => queueRow(i.qid, i.b, i.stage, opts)),
  });
  const toCall = (db.prepare("SELECT COUNT(*) n FROM businesses WHERE no_whatsapp=1 AND tel_norm!='' AND statut NOT IN ('perdu','paye')").get() as { n: number }).n;
  const toContact = (db.prepare("SELECT COUNT(*) n FROM businesses WHERE statut='a_contacter'").get() as { n: number }).n;
  return (
    <TodayView day={q.day} counts={q.counts} goals={{ newGoal: q.o.newGoal, newHard: q.o.newHard, relances: q.o.relances }}
      blocks={{ reponses: view("reponses"), relances: view("relances"), nouveaux: view("nouveaux") }} toCall={toCall} toContact={toContact} />
  );
}
