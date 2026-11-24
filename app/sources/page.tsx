import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { denueToken } from "@/lib/settings";
import { overtureMeta, overtureCount } from "@/lib/overture";
import { osmInstances } from "@/lib/osm";
import { totalNew } from "@/lib/denue-watch";
import { PageHead, fmtN } from "@/components/ui";
import { requireSession } from "@/lib/session";
import type { SP } from "@/lib/filters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sources · Bedolt CRM" };
const SRC = ["excel", "denue", "osm", "overture"];

type Card = { key: string; title: string; what: string; when: string; gives: string; state: [string, string]; extra?: React.ReactNode };

// Trouver des prospects : 4 sources, chacune expliquée en une phrase, avec son état.
export default async function Sources({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession("redirect");
  const sp = await searchParams;
  const src = typeof sp.src === "string" ? sp.src : "";
  if (SRC.includes(src)) {   // anciens liens /sources?src=denue&…
    const p = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (k === "src" || v === undefined ? [] : [[k, Array.isArray(v) ? v[0] : v]])));
    redirect(`/sources/${src}${p.size ? "?" + p : ""}`);
  }
  const imports = db.prepare("SELECT COUNT(*) n, MAX(created_at) last FROM import_batches WHERE cancelled_at IS NULL").get() as { n: number; last: string | null };
  const om = overtureMeta(), oc = overtureCount(), news = totalNew();
  const d = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");
  const cards: Card[] = [
    { key: "excel", title: "Import Excel / Gemini", what: "Tes fichiers de recherches (Gemini, Google Maps).", when: "Pour une liste ciblée et qualifiée : note, avis, angle et message déjà prêts.",
      gives: "Téléphone, note et avis Google, lien Maps, angle, message WhatsApp ; email / site / réseaux si présents.",
      state: ["ok", imports.n ? `Prêt · ${imports.n} import(s), dernier le ${d(imports.last)}` : "Prêt"] },
    { key: "denue", title: "DENUE (INEGI)", what: "Registre officiel des commerces du Mexique, tout le pays.", when: "Pour couvrir une ville ou un quartier en entier, par type d'activité.",
      gives: "Téléphone (souvent), adresse exacte et position, parfois email et site, taille de l'établissement.",
      state: denueToken() ? ["ok", "Prêt"] : ["warn", "À configurer : token DENUE"],
      extra: news ? <Link href="/sources/denue?tab=enregistrees" className="badge accent">{news} nouveau{news > 1 ? "x" : ""} à valider (veille)</Link> : null },
    { key: "overture", title: "Overture", what: "Grande base gratuite de commerces (Meta, Microsoft…), mise à jour chaque mois. Quintana Roo seulement pour l'instant.",
      when: "Pour trouver des commerces récents ou absents de DENUE, avec leurs réseaux sociaux.", gives: "Souvent téléphone + réseaux sociaux, site web, position.",
      state: oc ? ["ok", `Données du ${d(om.loaded_at)} · ${fmtN(oc)} lieux`] : ["warn", "À configurer : première synchronisation"] },
    { key: "osm", title: "OpenStreetMap", what: "Carte collaborative ; peu de commerces au Mexique, utile en complément.", when: "En complément, pour une zone précise (ville ou carte visible).",
      gives: "Parfois téléphone, site, réseaux et horaires ; position exacte.", state: ["ok", `Prêt · ${osmInstances().length} serveur(s) publics`] },
  ];
  return (
    <>
      <PageHead title="Sources" lead="Trouve de nouveaux prospects. Choisis une source : chacune fonctionne de la même façon (zone → niches → filtres → chercher → ajouter au CRM)."
        help={<p>Toutes les sources passent par le même contrôle des doublons : un commerce déjà dans le CRM (même identifiant, même téléphone ou nom proche à moins de 100 m) n'est jamais recréé ; « Compléter les fiches existantes » remplit seulement ses champs vides, sans toucher au statut.</p>} />
      <div className="src-cards">
        {cards.map((c) => (
          <article key={c.key} className="src-card">
            <div className="row spread"><h3>{c.title}</h3><span className={"state " + c.state[0]}>{c.state[1]}</span></div>
            <p className="small" style={{ margin: 0 }}>{c.what}</p>
            <dl><dt>Quand</dt><dd>{c.when}</dd><dt>On obtient</dt><dd>{c.gives}</dd></dl>
            {c.extra}
            <Link className={"btn" + (c.state[0] === "ok" ? " primary" : "")} href={`/sources/${c.key}`}>Ouvrir {c.title.split(" ")[0] === "Import" ? "l'import" : c.title.split(" (")[0]}</Link>
          </article>
        ))}
      </div>
    </>
  );
}
