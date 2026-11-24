import Link from "next/link";
import { queryBusinesses } from "@/lib/crm";
import Kanban from "@/components/Kanban";
import { BusinessItem } from "@/components/Bits";
import FilterPanel from "@/components/FilterPanel";
import { PageHead } from "@/components/ui";
import { filterOptions } from "@/lib/filter-options";
import { nicheList } from "@/lib/niches";
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
  const niches = new Map(nicheList(true).map((n) => [n.id, n]));
  return (
    <>
      <PageHead title="Pipeline" lead="Où en est chaque prospect, du premier contact au paiement. Glisse une carte (ordinateur) ou change son statut dans sa liste."
        actions={<div className="tabs" style={{ margin: 0 }}>
          <Link href={hrefWith(BASE, sp, { vue: undefined, statut: undefined })} className={vue === "kanban" ? "on" : ""}>Kanban</Link>
          <Link href={hrefWith(BASE, sp, { vue: "liste" })} className={vue === "liste" ? "on" : ""}>Liste</Link>
        </div>} />
      <FilterPanel mode="list" options={filterOptions()} niches={nicheList(false)} total={<b className="small">{total.toLocaleString("fr-FR")} fiches</b>} />
      <p className="tiny muted">{PER_PAGE} fiches par colonne et par page.</p>
      {vue === "kanban" ? (
        <>
          <Kanban key={JSON.stringify(sp)} columns={cols.map((c) => ({
            key: c.s.key, total: c.total, more: hrefWith("/commerces", {}, { vue: "toutes", statut: c.s.key }),
            cards: c.rows.map((b) => ({ id: b.id, nom: b.nom, ville: b.ville, activite: b.niche ? "" : b.activite, niche: b.niche_id ? niches.get(b.niche_id) ?? null : null, statut: b.statut, score: b.score, interet: b.interet,
              followup: b.statut === "contacte" ? b.next_followup : null, nextDate: b.next_date, nextStep: b.next_step, offre: b.offre, motif: b.perdu_motif })),
          }))} />
          <Pager base={BASE} sp={sp} page={Math.min(page, pages)} pages={pages} total={total} />
        </>
      ) : (
        <>
          <div className="tabs" style={{ flexWrap: "wrap" }}>
            {cols.map((c) => <Link key={c.s.key} href={hrefWith(BASE, sp, { vue: "liste", statut: c.s.key })} className={c.s.key === listStatut ? "on" : ""}>{c.s.label} ({c.total})</Link>)}
          </div>
          <div className="list">{listCol.rows.map((b) => <BusinessItem key={b.id} b={b} niche={b.niche_id ? niches.get(b.niche_id) ?? null : null} />)}</div>
          {listCol.rows.length === 0 && <div className="empty">Aucune fiche dans « {listCol.s.label} ».</div>}
          <Pager base={BASE} sp={sp} page={listCol.page} pages={listCol.pages} total={listCol.total} />
        </>
      )}
    </>
  );
}
