"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import { readPending, clearPending, type PendingWa as P } from "./wa-pending";

// Page rechargée après l'ouverture de WhatsApp (téléphone) : on redemande « Envoyé ? » pour ne rien perdre.
export default function PendingWa() {
  const router = useRouter();
  const [p, setP] = useState<P | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setP(readPending()); }, []);
  if (!p) return null;
  async function result(result: string, extra: object = {}) {
    setBusy(true);
    try {
      const r = await postJson<{ undo: number; message: string }>("/api/result", { id: p!.id, result, ...extra });
      toast(r.message, { undo: r.undo, businessId: p!.id });
      router.refresh();
    } catch (e) { toastError(e); }
    clearPending(); setP(null); setBusy(false);
  }
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="WhatsApp envoyé ?">
      <div className="card stack">
        <b>WhatsApp à {p.nom} : envoyé ?</b>
        <div className="grid g3">
          <button className="btn primary" disabled={busy} onClick={() => result("wa_sent", p.template ? { template: p.template } : {})}>Oui, envoyé</button>
          <button className="btn" disabled={busy} onClick={() => { clearPending(); setP(null); }}>Pas envoyé</button>
          <button className="btn" disabled={busy} onClick={() => result("no_wa", { toCall: true })}>Pas de WhatsApp</button>
        </div>
      </div>
    </div>
  );
}
