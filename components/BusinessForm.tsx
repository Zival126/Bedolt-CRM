import { saveBusiness } from "@/app/actions";
import ActionForm from "./ActionForm";
import { FICHES, INTERETS } from "@/lib/constants";
import { waState, type Business } from "@/lib/crm";
import { nicheList } from "@/lib/niches";

const F = ({ label, name, v, type = "text", full }: { label: string; name: string; v?: string | number | null; type?: string; full?: boolean }) => (
  <label className={"f" + (full ? " full" : "")}>{label}<input name={name} type={type} defaultValue={v ?? ""} step={type === "number" ? "any" : undefined} inputMode={type === "number" ? "decimal" : undefined} /></label>
);

export default function BusinessForm({ b }: { b?: Business }) {
  const niches = nicheList(true);
  const cur = b?.niche_id ? niches.find((n) => n.id === b.niche_id)?.label ?? b.niche : b?.niche ?? "";
  return (
    <ActionForm action={saveBusiness} className="card" submit="Enregistrer">
      {b && <input type="hidden" name="id" value={b.id} />}
      <div className="grid gform">
        <label className="f full">Nom *<input name="nom" required defaultValue={b?.nom ?? ""} /></label>
        <F label="Activité" name="activite" v={b?.activite} />
        <label className="f">Niche<select name="niche" defaultValue={cur}>
          <option value="">— Sans niche —</option>
          {niches.map((n) => <option key={n.id} value={n.label}>{n.label}</option>)}
          {cur && !niches.some((n) => n.label === cur) && <option value={cur}>{cur}</option>}
        </select></label>
        <F label="Zone" name="zone" v={b?.zone} />
        <label className="f">Offre<input name="offre" list="offres-form" maxLength={20} defaultValue={b?.offre ?? ""} placeholder="P1, P2, P3" />
          <datalist id="offres-form"><option value="P1" /><option value="P2" /><option value="P3" /></datalist></label>
        <F label="Présence web" name="presence_web" v={b?.presence_web} />
        <F label="Ville / municipio" name="ville" v={b?.ville} />
        <F label="Téléphone" name="telephone" v={b?.telephone} type="tel" />
        <F label="WhatsApp (si différent)" name="whatsapp" v={b?.whatsapp} type="tel" />
        <label className="f">WhatsApp
          <select name="wa_etat" defaultValue={b ? waState(b) : "inconnu"}>
            <option value="inconnu">Inconnu</option><option value="oui">Oui</option><option value="non">Non (pas de WhatsApp → À appeler)</option>
          </select></label>
        <F label="Email" name="email" v={b?.email} type="email" />
        <F label="Site web (https://…)" name="site_web" v={b?.site_web} />
        <F label="Facebook (lien ou @page)" name="facebook" v={b?.facebook} />
        <F label="Instagram (lien ou @compte)" name="instagram" v={b?.instagram} />
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
        <label className="f full">Angle (argument de vente)<textarea name="angle" maxLength={2000} defaultValue={b?.angle ?? ""} style={{ minHeight: 60 }} /></label>
        <label className="f full">Message WhatsApp personnalisé (premier message ; vide = modèle des Réglages)<textarea name="message_whatsapp" maxLength={5000} defaultValue={b?.message_whatsapp ?? ""} /></label>
        <label className="f full">Notes<textarea name="notes" defaultValue={b?.notes ?? ""} /></label>
      </div>
    </ActionForm>
  );
}
