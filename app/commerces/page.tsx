import Link from "next/link";
import { queryBusinesses, facet, SORTS } from "@/lib/crm";
import { prettyPhone, mapsPlaceUrl, waNumber } from "@/lib/phone";
import { suggestedTemplate } from "@/lib/whatsapp";
import { readFilters, hrefWith, filterQuery, VUES, type SP } from "@/lib/filters";
import BusinessList from "@/components/BusinessList";
import ListFilters from "@/components/ListFilters";
import Pager from "@/components/Pager";
import { requireSession } from "@/lib/session";

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
  const { vue, f, page } = readFilters(sp);
  const { rows, total, pages, page: p } = queryBusinesses(f, page);
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

      <BusinessList total={total} filterQuery={filterQuery(f)} rows={rows.map((b) => ({
        id: b.id, nom: b.nom, niche: b.niche, zone: b.zone, offre: b.offre, ville: b.ville, statut: b.statut, fiche_google: b.fiche_google,
        presence_web: b.presence_web, note_google: b.note_google, nb_avis: b.nb_avis, score: b.score, score_raison: b.score_raison,
        tel: b.tel_norm ? prettyPhone(b.telephone || b.tel_norm) : "", telHref: b.tel_norm ? `tel:+52${b.tel_norm}` : "",
        hasWa: !!waNumber(b.whatsapp || b.telephone), maps: mapsPlaceUrl(b), template: suggestedTemplate(b),
        hasMsg: !!b.message_whatsapp, angle: b.angle, motif: b.perdu_motif, noWa: !!b.no_whatsapp,
      }))} />
      <Pager base={BASE} sp={sp} page={p} pages={pages} total={total} />
    </>
  );
}
