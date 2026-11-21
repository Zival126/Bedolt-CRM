"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

type Tpl = "first" | "j2" | "j7";
const LABELS: Record<Tpl, string> = { first: "Premier message", j2: "Relance J+2", j7: "Relance J+7" };

async function post(body: object) {
  const r = await fetch("/api/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: "Réponse illisible du serveur." }));
  if (!r.ok) throw new Error(j.error ?? "Erreur");
  return j;
}

// Clic : le serveur propose le message (personnalisé de la fiche ou modèle des Réglages), modifiable ici.
// « Ouvrir WhatsApp » : le serveur vérifie la limite du jour, journalise « WhatsApp envoyé », puis on ouvre wa.me.
export default function WaButton({ id, template, label = "WhatsApp", disabled, limitReached, small }: {
  id: number; template?: Tpl; label?: string; disabled?: boolean; limitReached?: boolean; small?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ template: Tpl; text: string; custom: boolean; remaining: number } | null>(null);
  async function load(tpl?: Tpl) {
    setBusy(true);
    try { setOpen(await post({ id, template: tpl, prepare: true })); } catch (e) { alert((e as Error).message); }
    setBusy(false);
  }
  async function click() {
    if (limitReached) return alert("Limite du jour atteinte : 20 messages WhatsApp. Reprends demain.");
    await load(template);
  }
  async function send() {
    if (!open) return;
    setBusy(true);
    try {
      const j = await post({ id, template: open.template, text: open.text });
      setOpen(null);
      router.refresh();
      window.location.href = j.url;
    } catch (e) { alert((e as Error).message); }
    setBusy(false);
  }
  return (
    <>
      <button type="button" className={`btn wa${small ? " sm" : ""}${limitReached ? " off" : ""}`} disabled={disabled || busy} onClick={click}>
        {label}
      </button>
      {open && createPortal(
        <div className="modal" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className="card stack">
            <div className="row spread"><b>Message WhatsApp</b><button className="btn sm" onClick={() => setOpen(null)}>Fermer</button></div>
            <div className="tabs" style={{ margin: 0, flexWrap: "wrap" }}>
              {(Object.keys(LABELS) as Tpl[]).map((t) => (
                <button key={t} type="button" className={open.template === t ? "on" : ""} disabled={busy} onClick={() => load(t)}>{LABELS[t]}</button>
              ))}
            </div>
            <p className="small muted">{open.custom ? "Message personnalisé de la fiche." : "Modèle des Réglages."} Modifiable avant envoi · {open.remaining} message(s) restant(s) aujourd'hui.</p>
            <textarea value={open.text} maxLength={4000} rows={8} onChange={(e) => setOpen({ ...open, text: e.target.value })} />
            <div className="row"><button className="btn wa" disabled={busy || !open.text.trim()} onClick={send}>{busy ? "…" : "Ouvrir WhatsApp"}</button>
              <span className="small muted">L'envoi est journalisé et compte dans la limite du jour.</span></div>
          </div>
        </div>,
        document.body, // hors de la carte / du tableau : pas d'héritage de styles (largeur, nowrap)
      )}
    </>
  );
}
