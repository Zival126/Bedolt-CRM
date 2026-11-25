import Link from "next/link";
import { queryBusinesses, nicheFacet, SORTS, waState } from "@/lib/crm";
import { prettyPhone, mapsPlaceUrl, waNumber, safeHttpUrl } from "@/lib/phone";
import { suggestedTemplate } from "@/lib/whatsapp";
import { readFilters, hrefWith, filterQuery, VUES, type SP } from "@/lib/filters";
import BusinessList, { type SortLink } from "@/components/BusinessList";
import CommerceTools from "@/components/CommerceTools";
import FilterPanel from "@/components/FilterPanel";
import { PageHead } from "@/components/ui";
import { COLUMNS, type ColumnKey } from "@/lib/columns";
import { savedViews, commerceColumns } from "@/lib/views";
import { socialHref } from "@/lib/contacts";
import { filterOptions } from "@/lib/filter-options";
import { nicheList } from "@/lib/niches";
import Pager from "@/components/Pager";
import { requireSession } from "@/lib/session";
import { withQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";
export const metadata = { title: "Commerces · Bedolt CRM" };
const BASE = "/commerces";

export default async function Commerces({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession("redirect");
  const sp = await searchParams;
  const r = readFilters(sp);
  const { vue, page } = r;
  const f = withQueue(r.f);
  const grouped = sp.grp === "niche";
  const { rows, total, pages, page: p } = queryBusinesses(grouped ? { ...f, sort: "niche" } : f, page);
  const columns = commerceColumns();
  const sorts: Partial<Record<ColumnKey, SortLink>> = {};
  for (const c of COLUMNS) {
    if (!c.sort) continue;
    const active = f.sort === c.sort;
    sorts[c.key] = { active, inv: active && f.dir === "inv", href: hrefWith(BASE, sp, { sort: c.sort, dir: active && f.dir !== "inv" ? "inv" : undefined }) };
  }
  const note: Record<string, string> = {
    contacter: "Prospects jamais contactés, les meilleures offres d'abord.",
    appeler: "Numéros sans WhatsApp : appelle-les (sans quota).",
    perdues: "Hors des files : consultables et réactivables depuis la fiche.",
    toutes: "Toutes les fiches, quel que soit leur statut.",
  };
  const facet = nicheFacet(f);
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v[0] : v]]))).toString();
  return (
    <>
      <PageHead title="Commerces" lead="Tous tes prospects. Filtre par niche, coche des fiches, puis lance une action (WhatsApp, statut, « Ajouter à ma journée »)."
        actions={<><Link href="/commerces/new" className="btn primary">+ Ajouter un commerce</Link>
          <CommerceTools views={savedViews()} query={query} columns={columns} total={total} /></>} />
      <nav className="tabs" aria-label="Vues">
        {VUES.map((v) => <Link key={v.key} href={v.href} className={vue === v.key ? "on" : ""} aria-current={vue === v.key ? "page" : undefined}>{v.label}</Link>)}
      </nav>
      <FilterPanel mode="list" options={filterOptions()} niches={nicheList(false)} counts={Object.fromEntries(facet)}
        total={<b className="small" style={{ marginRight: 4 }}>{total.toLocaleString("fr-FR")} fiche{total > 1 ? "s" : ""}</b>}
        extra={<>
          <TriSelect sp={sp} sort={f.sort ?? ""} />
          <Link className={"btn" + (grouped ? " primary-soft" : "")} href={hrefWith(BASE, sp, { grp: grouped ? undefined : "niche" })} aria-pressed={grouped}>{grouped ? "✓ " : ""}Grouper par niche</Link>
        </>} />
      <p className="small muted" style={{ margin: "6px 0" }}>{note[vue]}</p>
      <BusinessList total={total} filterQuery={filterQuery(f)} columns={columns} sorts={sorts} grouped={grouped} facet={Object.fromEntries(facet)}
        niches={nicheList(true)} rows={rows.map((b) => ({
          id: b.id, nom: b.nom, niche: b.niche, nicheId: b.niche_id, specialite: b.specialite ?? "", zone: b.zone, offre: b.offre, ville: b.ville, statut: b.statut, fiche_google: b.fiche_google,
          presence_web: b.presence_web, note_google: b.note_google, nb_avis: b.nb_avis, score: b.score, score_raison: b.score_raison,
          tel: b.tel_norm ? prettyPhone(b.telephone || b.tel_norm) : "", telHref: b.tel_norm ? `tel:+52${b.tel_norm}` : "",
          hasWa: !!waNumber(b.whatsapp || b.telephone), maps: mapsPlaceUrl(b), template: suggestedTemplate(b),
          hasMsg: !!b.message_whatsapp, angle: b.angle, motif: b.perdu_motif, noWa: !!b.no_whatsapp,
          email: b.email, site: safeHttpUrl(b.site_web), facebook: socialHref("facebook", b.facebook), instagram: socialHref("instagram", b.instagram),
          wa: waState(b), source: b.source, colonia: b.colonia, etiquette: b.etiquette, ajout: (b.created_at ?? "").slice(0, 10),
          dnc: !!b.ne_pas_contacter, hasPos: b.lat != null,
        }))} />
      <Pager base={BASE} sp={sp} page={p} pages={pages} total={total} />
    </>
  );
}

/** Tri (liste déroulante, sans JavaScript : liens). */
function TriSelect({ sp, sort }: { sp: SP; sort: string }) {
  return (
    <details className="more">
      <summary className="btn">Trier : {SORTS.find((s) => s.key === sort)?.label ?? "colonne"}</summary>
      <div className="more-menu">{SORTS.map((s) => <Link key={s.key} href={hrefWith(BASE, sp, { sort: s.key, dir: undefined })} aria-current={s.key === sort ? "true" : undefined}>{s.key === sort ? "✓ " : ""}{s.label}</Link>)}</div>
    </details>
  );
}
