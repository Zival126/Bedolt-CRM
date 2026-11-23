import { todayQueue, withQueue } from "@/lib/queue";
import { queueRow } from "@/lib/rows";
import { businessActions, dayCounts, getBusiness, idsForFilter, type Business } from "@/lib/crm";
import { actionLabel } from "@/lib/constants";
import { mapsPlaceUrl } from "@/lib/phone";
import { readMapFilters, mapQuery, type SP } from "@/lib/filters";
import { stageOf, type Stage } from "@/lib/stage";
import { objectives } from "@/lib/settings";
import FocusView, { type FocusRow } from "@/components/FocusView";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const MAX_CARTE = 300;

// Mode focus : la file du jour, un prospect à la fois, dans le même ordre (réponses → relances → nouveaux).
// Depuis la Carte (?carte=1&filtres…) : les fiches du filtre (hors Payé), triées par offre puis nb d'avis.
export default async function Focus({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession("redirect");
  const sp = await searchParams;
  const row = (qid: number, b: Business, stage: Stage, opts: { hardLeft: number; hard: number }): FocusRow => ({
    ...queueRow(qid, b, stage, opts), web: b.presence_web, maps: mapsPlaceUrl(b),
    actions: businessActions(b.id, 3).map((a) => ({ label: actionLabel(a.type), content: a.content, at: a.at })),
  });

  if (sp.carte === "1") {
    const o = objectives();
    const c = dayCounts();
    const opts = { hardLeft: o.newHard - c.newWa, hard: o.newHard };
    const f = readMapFilters(sp);
    const items: FocusRow[] = [];
    for (const id of idsForFilter({ ...withQueue(f), sort: "offre" }, 2000)) {
      const b = getBusiness(id);
      if (!b) continue;
      const stage = stageOf(b);
      if (stage === "paye" || b.ne_pas_contacter) continue;   // « Ne pas contacter » : jamais en focus
      items.push(row(-b.id, b, stage, opts)); // qid négatif : hors file du jour (« Passer » reste local)
      if (items.length >= MAX_CARTE) break;
    }
    return <FocusView items={items} extra={[]} counts={c} goals={{ newGoal: o.newGoal, newHard: o.newHard, relances: o.relances }}
      exitHref={"/carte?" + mapQuery(f)} label="Fiches de la carte" />;
  }

  const q = todayQueue();
  const opts = { hardLeft: q.hardLeft, hard: q.o.newHard };
  const B = q.blocks;
  const r = (i: (typeof B.reponses.items)[number]) => row(i.qid, i.b, i.stage, opts);
  return (
    <FocusView
      items={[...B.reponses.items, ...B.relances.items, ...B.nouveaux.items].map(r)}
      extra={[...B.relances.extra, ...B.nouveaux.extra].map(r)}
      counts={q.counts} goals={{ newGoal: q.o.newGoal, newHard: q.o.newHard, relances: q.o.relances }} />
  );
}
