import Link from "next/link";
import { queryBusinesses } from "@/lib/crm";
import Kanban from "@/components/Kanban";
import { BusinessItem } from "@/components/Bits";
import ListFilters from "@/components/ListFilters";
import Pager from "@/components/Pager";
import { STATUTS, PER_PAGE } from "@/lib/constants";
import { readFilters, hrefWith, type SP } from "@/lib/filters";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const BASE = "/pipeline";

// Pagination serveur : 50 fiches par colonne et par page ; chaque colonne affiche son total réel.
export default async function Pipeline({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession("redirect");
  const sp = await searchParams;
  const vue = sp.vue === "liste" ? "liste" : "kanban";
  const { f, page } = readFilters({ ...sp, vue: "toutes", sort: sp.sort ?? "offre" });
  delete f.statut;
  const cols = STATUTS.map((s) => ({ s, ...queryBusinesses({ ...f, statut: s.key }, page) }));
  const pages = Math.max(...cols.map((c) => c.pages));
  const total = cols.reduce((a, c) => a + c.total, 0);
  const listStatut = STATUTS.some((s) => s.key === sp.statut) ? String(sp.statut) : "a_contacter";
  const listCol = cols.find((c) => c.s.key === listStatut)!;
  return (
    <>
      <div className="row spread"><h1>Pipeline</h1>
        <div className="tabs" style={{ margin: 0 }}>
          <Link href={hrefWith(BASE, sp, { vue: undefined, statut: undefined })} className={vue === "kanban" ? "on" : ""}>Kanban</Link>
          <Link href={hrefWith(BASE, sp, { vue: "liste" })} className={vue === "liste" ? "on" : ""}>Liste</Link>
        </div>
      </div>
      <div style={{ marginTop: 10 }}><ListFilters base={BASE} vue={vue === "liste" ? "liste" : "contacter"} f={f} hideStatut resetHref={vue === "liste" ? "/pipeline?vue=liste" : "/pipeline"} /></div>
      <p className="small"><b>{total.toLocaleString("fr-FR")} fiches</b> <span className="muted">· {PER_PAGE} par colonne et par page · glisse une carte (ordinateur) ou change son statut dans le menu</span></p>
      {vue === "kanban" ? (
        <>
          <Kanban key={JSON.stringify(sp)} columns={cols.map((c) => ({
            key: c.s.key, total: c.total, more: hrefWith("/commerces", {}, { vue: "toutes", statut: c.s.key }),
            cards: c.rows.map((b) => ({ id: b.id, nom: b.nom, ville: b.ville, activite: b.niche || b.activite, statut: b.statut, score: b.score, interet: b.interet,
              followup: b.statut === "contacte" ? b.next_followup : null, nextDate: b.next_date, nextStep: b.next_step, offre: b.offre, motif: b.perdu_motif })),
          }))} />
          <Pager base={BASE} sp={sp} page={Math.min(page, pages)} pages={pages} total={total} />
        </>
      ) : (
        <>
          <div className="tabs" style={{ flexWrap: "wrap" }}>
            {cols.map((c) => <Link key={c.s.key} href={hrefWith(BASE, sp, { vue: "liste", statut: c.s.key })} className={c.s.key === listStatut ? "on" : ""}>{c.s.label} ({c.total})</Link>)}
          </div>
          <div className="list">{listCol.rows.map((b) => <BusinessItem key={b.id} b={b} />)}</div>
          {listCol.rows.length === 0 && <div className="empty">Aucune fiche dans « {listCol.s.label} ».</div>}
          <Pager base={BASE} sp={sp} page={listCol.page} pages={listCol.pages} total={listCol.total} />
        </>
      )}
    </>
  );
}
