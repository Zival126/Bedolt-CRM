import Link from "next/link";
import { listBusinesses } from "@/lib/crm";
import Kanban from "@/components/Kanban";
import { BusinessItem } from "@/components/Bits";
import { STATUTS } from "@/lib/constants";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Pipeline({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  await requireSession("redirect");
  const vue = (await searchParams).vue === "liste" ? "liste" : "kanban";
  const all = listBusinesses({ sort: "score" }, 1000);
  return (
    <>
      <div className="row spread"><h1>Pipeline</h1>
        <div className="tabs" style={{ margin: 0 }}>
          <Link href="/pipeline" className={vue === "kanban" ? "on" : ""}>Kanban</Link>
          <Link href="/pipeline?vue=liste" className={vue === "liste" ? "on" : ""}>Liste</Link>
        </div>
      </div>
      {vue === "kanban" ? (
        <Kanban cards={all.map((b) => ({ id: b.id, nom: b.nom, ville: b.ville, activite: b.activite, statut: b.statut, score: b.score, interet: b.interet, followup: b.next_followup }))} />
      ) : (
        STATUTS.map((s) => {
          const rows = all.filter((b) => b.statut === s.key);
          return (
            <div key={s.key}>
              <h2>{s.label} ({rows.length})</h2>
              <div className="list">{rows.map((b) => <BusinessItem key={b.id} b={b} />)}</div>
            </div>
          );
        })
      )}
    </>
  );
}
