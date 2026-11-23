"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { waUrl } from "@/lib/stage";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import { setPending, clearPending, isTouch } from "./wa-pending";

type Tpl = "first" | "j2" | "j7";
const LABELS: Record<Tpl, string> = { first: "Premier message", j2: "Relance J+2", j7: "Relance J+7" };
type Prep = { template: Tpl; text: string; custom: boolean; number: string; isNew: boolean; remaining: number | null };

// Listes et fiche : le serveur prépare le message (et applique la limite dure du jour), on peut le modifier,
// « Ouvrir WhatsApp » ouvre wa.me, puis « Envoyé ? » enregistre le résultat (relances programmées, toast Annuler).
export default function WaButton({ id, nom, template, label = "WhatsApp", disabled, small }: {
  id: number; nom: string; template?: Tpl; label?: string; disabled?: boolean; small?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Prep | null>(null);
  const [asked, setAsked] = useState(false);
  async function load(tpl?: Tpl) {
    setBusy(true);
    try { setOpen(await postJson<Prep>("/api/whatsapp", { id, template: tpl })); setAsked(false); } catch (e) { toastError(e); }
    setBusy(false);
  }
  async function result(result: string, extra: object = {}) {
    setBusy(true);
    try {
      const r = await postJson<{ undo: number; message: string }>("/api/result", { id, result, ...extra });
      toast(r.message, { undo: r.undo, businessId: id });
      setOpen(null); router.refresh();
    } catch (e) { toastError(e); }
    setBusy(false);
  }
  const href = open ? waUrl(open.number, open.text) : "";
  return (
    <>
      <button type="button" className={`btn wa${small ? " sm" : ""}`} disabled={disabled || busy} onClick={() => load(template)}>{label}</button>
      {open && createPortal(
        <div className="modal" role="dialog" aria-modal="true" aria-label="Message WhatsApp" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className="card stack">
            <div className="row spread"><b>WhatsApp · {nom}</b><button className="btn sm ghost" onClick={() => setOpen(null)}>Fermer</button></div>
            {asked ? (
              <div className="ask">
                <b>Envoyé ?</b>
                <div className="grid g3">
                  <button className="btn primary" disabled={busy} onClick={() => { clearPending(); result("wa_sent", { template: open.template }); }}>Oui, envoyé</button>
                  <button className="btn" disabled={busy} onClick={() => { clearPending(); setOpen(null); }}>Pas envoyé</button>
                  <button className="btn" disabled={busy} onClick={() => { clearPending(); result("no_wa", { toCall: true }); }}>Pas de WhatsApp</button>
                </div>
              </div>
            ) : (
              <>
                <div className="tabs" style={{ margin: 0, flexWrap: "wrap" }}>
                  {(Object.keys(LABELS) as Tpl[]).map((t) => (
                    <button key={t} type="button" className={open.template === t ? "on" : ""} disabled={busy} onClick={() => load(t)}>{LABELS[t]}</button>
                  ))}
                </div>
                <p className="small muted">{open.custom ? "Message personnalisé de la fiche." : "Modèle des Réglages."} Modifiable avant envoi{open.remaining !== null ? ` · ${open.remaining} nouveau(x) WhatsApp possible(s) aujourd'hui` : ""}.</p>
                <textarea value={open.text} maxLength={4000} rows={8} onChange={(e) => setOpen({ ...open, text: e.target.value })} placeholder="Message vide : WhatsApp s'ouvre sans texte." />
                <a className="btn wa big" href={href} rel="noopener noreferrer" onClick={(e) => {
                  setPending({ id, nom, template: open.template, at: Date.now() });
                  if (!isTouch()) { e.preventDefault(); window.open(href, "_blank", "noopener"); }
                  setAsked(true);
                }}>Ouvrir WhatsApp</a>
                <p className="small muted">Au retour, confirme l'envoi : il est journalisé et programme les relances.</p>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
