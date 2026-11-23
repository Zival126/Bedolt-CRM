import { todayQueue } from "@/lib/queue";
import { queueRow } from "@/lib/rows";
import { businessActions, type Business } from "@/lib/crm";
import { actionLabel } from "@/lib/constants";
import { mapsPlaceUrl } from "@/lib/phone";
import FocusView, { type FocusRow } from "@/components/FocusView";
import { requireSession } from "@/lib/session";
import type { QueueItem } from "@/lib/queue";

export const dynamic = "force-dynamic";

// Mode focus : la file du jour, un prospect à la fois, dans le même ordre (réponses → relances → nouveaux).
export default async function Focus() {
  await requireSession("redirect");
  const q = todayQueue();
  const opts = { hardLeft: q.hardLeft, hard: q.o.newHard };
  const row = (i: QueueItem): FocusRow => {
    const b: Business = i.b;
    return {
      ...queueRow(i.qid, b, i.stage, opts), web: b.presence_web, maps: mapsPlaceUrl(b),
      actions: businessActions(b.id, 3).map((a) => ({ label: actionLabel(a.type), content: a.content, at: a.at })),
    };
  };
  const B = q.blocks;
  return (
    <FocusView
      items={[...B.reponses.items, ...B.relances.items, ...B.nouveaux.items].map(row)}
      extra={[...B.relances.extra, ...B.nouveaux.extra].map(row)}
      counts={q.counts} goals={{ newGoal: q.o.newGoal, relances: q.o.relances }} />
  );
}
