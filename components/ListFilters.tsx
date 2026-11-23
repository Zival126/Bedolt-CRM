import Link from "next/link";
import { distinct, SORTS, type Filters } from "@/lib/crm";
import { STATUTS, FICHES } from "@/lib/constants";
import { db } from "@/lib/db";

const lots = () => db.prepare("SELECT id, file_name FROM import_batches ORDER BY id DESC LIMIT 30").all() as { id: number; file_name: string }[];

// Formulaire GET : les filtres vivent dans l'URL (partageables, gardés au retour arrière).
export default function ListFilters({ base, vue, f, hideStatut, resetHref }: { base: string; vue: string; f: Filters; hideStatut?: boolean; resetHref: string }) {
  const sel = (name: keyof Filters, label: string, values: string[], withNone = true) => (
    <select name={name} defaultValue={f[name] ?? ""} aria-label={label}>
      <option value="">{label} : toutes</option>
      {withNone && <option value="none">{label} : non renseignée</option>}
      {values.map((v) => <option key={v} value={v}>{v}</option>)}
    </select>
  );
  const active = ["niche", "zone", "offre", "ville", "fiche", "web", "note_min", "avis_min", "lot", "msg"].filter((k) => f[k as keyof Filters]).length;
  return (
    <form action={base} className="card stack" style={{ marginBottom: 10 }}>
      {vue !== "contacter" && <input type="hidden" name="vue" value={vue} />}
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input name="q" placeholder="Nom ou téléphone" defaultValue={f.q} style={{ flex: 1 }} />
        <button className="btn primary">Filtrer</button>
      </div>
      <details className="filters" open={active > 0}>
        <summary className="small muted">▸ Plus de filtres{active ? ` (${active} actif${active > 1 ? "s" : ""})` : ""}</summary>
        <div className="grid g2" style={{ marginTop: 8 }}>
          {!hideStatut && (
            <select name="statut" defaultValue={f.statut ?? ""} aria-label="Statut">
              <option value="">Tous statuts</option>{STATUTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}
          {sel("niche", "Niche", distinct("niche"))}
          {sel("zone", "Zone", distinct("zone"))}
          {sel("offre", "Offre", distinct("offre"))}
          {sel("ville", "Ville", distinct("ville"), false)}
          {sel("web", "Présence web", distinct("presence_web"))}
          <select name="fiche" defaultValue={f.fiche ?? ""} aria-label="Fiche Google">
            <option value="">Fiche Google : toutes</option>{FICHES.map((s) => <option key={s.key} value={s.key || "none"}>Fiche : {s.key ? s.label : "non renseignée"}</option>)}
          </select>
          <select name="msg" defaultValue={f.msg ?? ""} aria-label="Message WhatsApp">
            <option value="">Message WhatsApp : tous</option><option value="1">A un message WhatsApp</option><option value="0">Sans message WhatsApp</option>
          </select>
          <input name="note_min" type="number" step="0.1" min={0} max={5} inputMode="decimal" placeholder="Note Google min. (ex. 4)" defaultValue={f.note_min} />
          <input name="avis_min" type="number" step="1" min={0} inputMode="numeric" placeholder="Nb d'avis min." defaultValue={f.avis_min} />
          <select name="lot" defaultValue={f.lot ?? ""} aria-label="Lot d'import">
            <option value="">Lot d'import : tous</option>{lots().map((l) => <option key={l.id} value={l.id}>#{l.id} · {l.file_name}</option>)}
          </select>
          <select name="sort" defaultValue={f.sort} aria-label="Tri">{SORTS.map((s) => <option key={s.key} value={s.key}>Tri : {s.label}</option>)}</select>
        </div>
        <div className="row" style={{ marginTop: 8 }}><button className="btn">Appliquer</button><Link href={resetHref} className="btn">Réinitialiser</Link></div>
      </details>
    </form>
  );
}
