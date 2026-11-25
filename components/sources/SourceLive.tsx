"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "../client-api";
import { toast, toastError } from "../Toast";

type Place = { nom: string; categorie: string; telephone: string; site_web: string; email: string; adresse: string; ville: string; maps: string };
type P = { key: string; label: string; enabled: boolean; attribution: string };
const FIELDS: [keyof Place, string, string][] = [["telephone", "Téléphone", "telephone"], ["site_web", "Site web", "site_web"], ["email", "Email", "email"],
  ["adresse", "Adresse", "adresse"], ["ville", "Ville", "ville"], ["categorie", "Catégorie → spécialité", "specialite"]];

// Fiche : infos d'une source API consultées en direct (1 appel, rien n'est stocké) ; l'utilisateur choisit quoi copier.
export default function SourceLive({ businessId, providers, current }: { businessId: number; providers: P[]; current: Record<string, string> }) {
  const router = useRouter();
  const [open, setOpen] = useState<{ p: P; place: Place | null; used: number; cap: number } | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  async function load(p: P) {
    setBusy(true);
    try {
      const r = await postJson<{ place: Place | null; used: number; cap: number }>("/api/sources/places", { action: "details", provider: p.key, businessId });
      setOpen({ p, ...r });
      setPick(new Set(FIELDS.filter(([k, , f]) => r.place?.[k] && !current[f]).map(([k]) => k)));
    } catch (e) { toastError(e); }
    setBusy(false);
  }
  async function copy() {
    if (!open?.place || !pick.size) return;
    const fields = Object.fromEntries(FIELDS.filter(([k]) => pick.has(k)).map(([k, , f]) => [f, open.place![k]]));
    try { await postJson("/api/sources/places", { action: "copy", provider: open.p.key, businessId, fields }); toast(`${pick.size} champ(s) copié(s) dans la fiche.`); setOpen(null); router.refresh(); }
    catch (e) { toastError(e); }
  }
  if (!providers.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        {providers.map((p) => <button key={p.key} type="button" className="btn sm" disabled={!p.enabled || busy} title={p.enabled ? "1 appel, rien n'est enregistré" : "Clé requise"} onClick={() => load(p)}>Infos {p.label} en direct</button>)}
      </div>
      {open && (
        <div className="card stack" style={{ gap: 6, background: "var(--panel2)" }}>
          <div className="row spread"><b className="small">{open.p.label} · en direct</b><span className="tiny muted">{open.used} / {open.cap} appels ce mois</span></div>
          {!open.place ? <span className="small muted">Lieu introuvable chez {open.p.label} (fermé ou identifiant expiré).</span> : <>
            {FIELDS.filter(([k]) => open.place![k]).map(([k, l, f]) => (
              <label key={k} className="chk small" style={{ alignItems: "flex-start" }}>
                <input type="checkbox" checked={pick.has(k)} onChange={() => setPick((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })} />
                <span><span className="muted">{l} : </span>{open.place![k]}{current[f] ? <span className="tiny warn-text"> (remplace « {current[f]} »)</span> : null}</span>
              </label>))}
            <div className="row"><button type="button" className="btn sm primary" disabled={!pick.size} onClick={copy}>Copier dans la fiche ({pick.size})</button>
              <button type="button" className="btn sm ghost" onClick={() => setOpen(null)}>Fermer</button></div>
          </>}
          <span className="tiny muted">{open.p.attribution} · affiché sans être enregistré ; seul ce que tu copies est gardé (avec son origine).</span>
        </div>
      )}
    </div>
  );
}
