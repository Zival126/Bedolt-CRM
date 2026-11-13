import { saveBusiness } from "@/app/actions";
import { FICHES, INTERETS } from "@/lib/constants";
import type { Business } from "@/lib/crm";

const F = ({ label, name, v, type = "text", full }: { label: string; name: string; v?: string | number | null; type?: string; full?: boolean }) => (
  <label className={"f" + (full ? " full" : "")}>{label}<input name={name} type={type} defaultValue={v ?? ""} step={type === "number" ? "any" : undefined} inputMode={type === "number" ? "decimal" : undefined} /></label>
);

export default function BusinessForm({ b }: { b?: Business }) {
  return (
    <form action={saveBusiness} className="card">
      {b && <input type="hidden" name="id" value={b.id} />}
      <div className="grid gform">
        <label className="f full">Nom *<input name="nom" required defaultValue={b?.nom ?? ""} /></label>
        <F label="Activité" name="activite" v={b?.activite} />
        <F label="Ville / municipio" name="ville" v={b?.ville} />
        <F label="Téléphone" name="telephone" v={b?.telephone} type="tel" />
        <F label="WhatsApp (si différent)" name="whatsapp" v={b?.whatsapp} type="tel" />
        <F label="Email" name="email" v={b?.email} type="email" />
        <F label="Site web" name="site_web" v={b?.site_web} />
        <F label="Adresse" name="adresse" v={b?.adresse} full />
        <F label="Colonia" name="colonia" v={b?.colonia} />
        <F label="Latitude" name="lat" v={b?.lat} type="number" />
        <F label="Longitude" name="lng" v={b?.lng} type="number" />
        <label className="f">Fiche Google
          <select name="fiche_google" defaultValue={b?.fiche_google ?? ""}>{FICHES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
        </label>
        <label className="f">Intérêt
          <select name="interet" defaultValue={b?.interet ?? ""}>{INTERETS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
        </label>
        <F label="Lien de la fiche Google" name="lien_google" v={b?.lien_google} full />
        <F label="Note Google" name="note_google" v={b?.note_google} type="number" />
        <F label="Nb d'avis" name="nb_avis" v={b?.nb_avis} type="number" />
        <label className="f full">Notes<textarea name="notes" defaultValue={b?.notes ?? ""} /></label>
      </div>
      <div className="row" style={{ marginTop: 12 }}><button className="btn primary">Enregistrer</button></div>
    </form>
  );
}
