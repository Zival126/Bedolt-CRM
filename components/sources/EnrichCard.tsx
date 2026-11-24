"use client";
import { useCallback, useEffect, useState } from "react";
import { getJson, postJson } from "../client-api";
import { toast, toastError } from "../Toast";

type S = { total: number; done: number; pending: number; found: number; nothing: number; failed: number; eligible: number; enabled: boolean; running: boolean };
const n = (x: number) => x.toLocaleString("fr-FR");

// Enrichissement en arrière-plan (site web → email, réseaux, WhatsApp) : progression et lancement manuel.
export default function EnrichCard() {
  const [s, setS] = useState<S | null>(null);
  const poll = useCallback(async () => { try { const r = await getJson<S>("/api/enrich"); setS(r); return r; } catch { return null; } }, []);
  useEffect(() => { poll(); }, [poll]);
  useEffect(() => {
    if (!s || s.pending <= 0) return;
    const t = setInterval(poll, 2500);
    return () => clearInterval(t);
  }, [s?.pending ? 1 : 0, poll]); // eslint-disable-line react-hooks/exhaustive-deps
  async function start() {
    try { const r = await postJson<{ added: number; status: S }>("/api/enrich", { action: "all" }); setS(r.status); toast(r.added ? `${n(r.added)} fiche(s) à enrichir.` : "Aucune nouvelle fiche à enrichir."); }
    catch (e) { toastError(e); }
  }
  if (!s) return null;
  const running = s.pending > 0;
  return (
    <div className="card stack enrich-card" style={{ gap: 6, padding: 12 }}>
      <div className="row spread"><b className="small">Enrichissement (site web → email, réseaux, WhatsApp)</b>
        {!running && <button type="button" className="btn sm" disabled={!s.eligible || !s.enabled} onClick={start}>Enrichir les fiches{s.eligible ? ` (${n(s.eligible)})` : ""}</button>}</div>
      {running ? (<>
        <div className="row spread small"><span>En cours… 1 requête / seconde par site · continue sur le serveur</span><b>{n(s.done)} / {n(s.total)}</b></div>
        <div className="bar"><i style={{ width: (s.done / Math.max(1, s.total)) * 100 + "%" }} /></div>
      </>) : s.total > 0 ? <span className="tiny muted">Dernier lot : {n(s.found)} enrichie(s), {n(s.nothing)} sans nouvelle info, {n(s.failed)} site(s) injoignable(s) / bloqué(s) sur {n(s.total)}.</span>
        : <span className="tiny muted">Fiches avec un site et sans email. Lancé aussi automatiquement après chaque ajout ou import.</span>}
      {!s.enabled && <span className="tiny warn-text">Enrichissement désactivé sur ce serveur (ENRICHER=off).</span>}
    </div>
  );
}
