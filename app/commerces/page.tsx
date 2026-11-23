import Link from "next/link";
import { queryBusinesses, facet, SORTS, distinct, waState } from "@/lib/crm";
import { prettyPhone, mapsPlaceUrl, waNumber } from "@/lib/phone";
import { suggestedTemplate } from "@/lib/whatsapp";
import { readFilters, hrefWith, filterQuery, VUES, type SP } from "@/lib/filters";
import BusinessList, { type SortLink } from "@/components/BusinessList";
import ContactChips from "@/components/ContactChips";
import CommerceTools from "@/components/CommerceTools";
import { COLUMNS, type ColumnKey } from "@/lib/columns";
import { savedViews, commerceColumns } from "@/lib/views";
import { socialHref } from "@/lib/contacts";
import { safeHttpUrl } from "@/lib/phone";
import ListFilters from "@/components/ListFilters";
import Pager from "@/components/Pager";
import { requireSession } from "@/lib/session";
import { withQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";
const BASE = "/commerces";

function Facets({ title, dim, items, sp, current }: { title: string; dim: string; items: { v: string; n: number }[]; sp: SP; current?: string }) {
  if (!items.length || (items.length === 1 && !items[0].v)) return null;
  return (
    <div className="row" style={{ alignItems: "baseline", flexWrap: "nowrap" }}>
      <span className="small muted" style={{ minWidth: 42 }}>{title}</span>
      <div className="chips scroll">
        {current && <Link href={hrefWith(BASE, sp, { [dim]: undefined })} className="on">× {current === "none" ? "non renseignée" : current}</Link>}
        {items.filter((i) => (i.v || "none") !== current).map((i) => (
          <Link key={i.v || "none"} href={hrefWith(BASE, sp, { [dim]: i.v || "none" })}>{i.v || "non renseignée"} · {i.n}</Link>
        ))}
      </div>
    </div>
  );
}

export default async function Commerces({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession("redirect");
  const sp = await searchParams;
  const r = readFilters(sp);
  const { vue, page } = r;
  const f = withQueue(r.f);
  const { rows, total, pages, page: p } = queryBusinesses(f, page);
  const columns = commerceColumns();
  // En-têtes triables : 1er clic = tri par défaut de la colonne, 2e clic = ordre inverse.
  const sorts: Partial<Record<ColumnKey, SortLink>> = {};
  for (const c of COLUMNS) {
    if (!c.sort) continue;
    const active = f.sort === c.sort;
    sorts[c.key] = { active, inv: active && f.dir === "inv", href: hrefWith(BASE, sp, { sort: c.sort, dir: active && f.dir !== "inv" ? "inv" : undefined }) };
  }
  const note: Record<string, string> = {
    contacter: "À contacter · triées par offre puis nb d'avis",
    appeler: "Numéros sans WhatsApp : appelle-les (sans quota)",
    perdues: "Hors des files · consultables et réactivables depuis la fiche",
    toutes: "",
  };
  return (
    <>
      <div className="row spread"><h1 style={{ margin: 0 }}>Commerces</h1><Link href="/commerces/new" className="btn primary">+ Ajouter</Link></div>
      <div className="tabs" style={{ marginTop: 12 }}>
        {VUES.map((v) => <Link key={v.key} href={v.href} className={vue === v.key ? "on" : ""}>{v.label}</Link>)}
      </div>
      <ListFilters base={BASE} vue={vue} f={f} resetHref={VUES.find((v) => v.key === vue)!.href} />
      <ContactChips base={BASE} sp={sp} sources={distinct("source")} />
      <CommerceTools views={savedViews()} query={new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v[0] : v]]))).toString()}
        columns={columns} total={total} />

      <div className="card stack" style={{ padding: 10 }}>
        <div className="row spread">
          <b>{total.toLocaleString("fr-FR")} fiche{total > 1 ? "s" : ""}</b>
          <span className="small muted">{note[vue]}</span>
        </div>
        <Facets title="Niche" dim="niche" items={facet(f, "niche")} sp={sp} current={f.niche} />
        <Facets title="Zone" dim="zone" items={facet(f, "zone")} sp={sp} current={f.zone} />
      </div>

      <div className="row small" style={{ marginTop: 8 }}>
        <span className="muted">Trier :</span>
        {SORTS.map((s) => f.sort === s.key ? <b key={s.key}>{s.label}</b> : <Link key={s.key} href={hrefWith(BASE, sp, { sort: s.key })}>{s.label}</Link>)}
      </div>

      <BusinessList total={total} filterQuery={filterQuery(f)} columns={columns} sorts={sorts} rows={rows.map((b) => ({
        id: b.id, nom: b.nom, niche: b.niche, zone: b.zone, offre: b.offre, ville: b.ville, statut: b.statut, fiche_google: b.fiche_google,
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
