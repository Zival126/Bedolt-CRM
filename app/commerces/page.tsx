import Link from "next/link";
import { listBusinesses, distinct, type Filters } from "@/lib/crm";
import { STATUTS, FICHES } from "@/lib/constants";
import { prettyPhone } from "@/lib/phone";
import RankList from "@/components/RankList";

export const dynamic = "force-dynamic";

export default async function Commerces({ searchParams }: { searchParams: Promise<Filters> }) {
  const f = await searchParams;
  const rows = listBusinesses(f);
  const sortHref = (s: string) => "/commerces?" + new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), sort: s }).toString();
  return (
    <>
      <div className="row spread"><h1>Commerces</h1><Link href="/commerces/new" className="btn primary">+ Ajouter</Link></div>
      <form className="card grid g2" style={{ marginBottom: 10 }}>
        <input name="q" placeholder="Nom ou téléphone" defaultValue={f.q} className="full" style={{ gridColumn: "1 / -1" }} />
        <select name="ville" defaultValue={f.ville ?? ""}><option value="">Toutes les villes</option>{distinct("ville").map((v) => <option key={v}>{v}</option>)}</select>
        <select name="activite" defaultValue={f.activite ?? ""}><option value="">Toutes activités</option>{distinct("activite").map((v) => <option key={v}>{v}</option>)}</select>
        <select name="statut" defaultValue={f.statut ?? ""}><option value="">Tous statuts</option>{STATUTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        <select name="fiche" defaultValue={f.fiche ?? ""}><option value="">Fiche Google : toutes</option>{FICHES.map((s) => <option key={s.key} value={s.key || "none"}>{s.key ? s.label : "Non renseignée"}</option>)}</select>
        <input type="hidden" name="sort" value={f.sort ?? ""} />
        <button className="btn">Filtrer</button><Link href="/commerces" className="btn">Réinitialiser</Link>
      </form>
      <div className="row small"><span className="muted">Trier :</span><Link href={sortHref("")}>récents</Link><Link href={sortHref("score")}>score IA</Link><Link href={sortHref("nom")}>nom</Link></div>
      <RankList rows={rows.map((b) => ({ id: b.id, nom: b.nom, activite: b.activite, ville: b.ville, statut: b.statut, fiche_google: b.fiche_google, score: b.score, score_raison: b.score_raison, tel: b.tel_norm ? prettyPhone(b.telephone) : "" }))} />
    </>
  );
}
