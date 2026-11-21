"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportBatch } from "@/lib/crm";
import { TZ } from "@/lib/constants";

const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });

export default function ImportBatches({ batches }: { batches: ImportBatch[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState<Record<number, string>>({});
  async function cancel(b: ImportBatch) {
    if (!confirm(`Annuler l'import « ${b.file_name} » ? Les ${b.remaining} fiche(s) encore liées à ce lot seront supprimées, sauf celles qui ont une action au journal ou un statut modifié.`)) return;
    setBusy(b.id);
    const r = await fetch("/api/import/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: b.id }) });
    const j = await r.json().catch(() => ({}));
    setMsg({ ...msg, [b.id]: r.ok ? `${j.deleted} supprimée(s), ${j.kept} conservée(s)` : `⚠️ ${j.error ?? "erreur"}` });
    setBusy(0); router.refresh();
  }
  if (!batches.length) return <p className="muted small">Aucun import pour l'instant.</p>;
  return (
    <div className="list">
      {batches.map((b) => (
        <div key={b.id} className="item">
          <div className="row spread"><span className="t">#{b.id} · {b.file_name}</span><span className="muted small">{fmt(b.created_at)}{b.duration_ms != null ? ` · ${b.duration_ms < 1000 ? `${b.duration_ms} ms` : `${(b.duration_ms / 1000).toFixed(1)} s`}` : ""}</span></div>
          <div className="s">{b.added} ajoutée(s) · {b.updated} mise(s) à jour · {b.ignored} ignorée(s) · {b.errors} erreur(s) · {b.remaining} fiche(s) encore liées
            {b.cancelled_at && <> · <span style={{ color: "var(--warn)" }}>annulé le {fmt(b.cancelled_at)} ({b.cancelled_deleted ?? 0} supprimée(s){b.cancelled_kept ? `, ${b.cancelled_kept} conservée(s)` : ""})</span></>}</div>
          <div className="row" style={{ marginTop: 6 }}>
            {b.remaining > 0 && <Link className="btn sm" href={`/commerces?vue=toutes&lot=${b.id}`}>Voir les fiches</Link>}
            {b.remaining > 0 && <button className="btn sm danger" disabled={busy === b.id} onClick={() => cancel(b)}>{busy === b.id ? "Annulation…" : "Annuler cet import"}</button>}
            {msg[b.id] && <span className="small">{msg[b.id]}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
