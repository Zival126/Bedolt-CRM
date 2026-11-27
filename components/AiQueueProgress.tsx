"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";

export type QueueState = { total: number; pending: number; done: number; errors: number; state: "idle" | "running" | "offline" | "unconfigured"; running: boolean;
  current: { id: number; nom: string } | null; message: string; lastError: string; night: { enabled: boolean; time: string }; nightLast: string | null };
export const QUEUE_EVENT = "bedolt:ai-queue";
/** Signale aux barres de progression qu'un lot vient d'être ajouté (relecture immédiate). */
export const queueChanged = () => window.dispatchEvent(new Event(QUEUE_EVENT));

/** Progression de la file IA (Commerces, Aujourd'hui, Réglages) : relue toutes les 3 s tant qu'il reste du travail. */
export default function AiQueueProgress({ always = false }: { always?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState<QueueState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDone = useRef<number | null>(null);
  const load = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const r = await fetch("/api/ai/queue", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as QueueState;
      setQ(j);
      if (prevDone.current !== null && j.done > prevDone.current) router.refresh(); // nouveaux brouillons à afficher
      prevDone.current = j.done;
      if (j.pending > 0 || j.running) timer.current = setTimeout(load, j.state === "offline" ? 15_000 : 3000);
    } catch { /* réseau : on réessaie au prochain événement */ }
  }, [router]);
  useEffect(() => {
    load();
    window.addEventListener(QUEUE_EVENT, load);
    return () => { window.removeEventListener(QUEUE_EVENT, load); if (timer.current) clearTimeout(timer.current); };
  }, [load]);
  if (!q || (!always && q.pending === 0 && !q.running)) return null;
  const pct = q.total ? Math.round((q.done / q.total) * 100) : 0;
  async function clear() {
    if (!confirm(`Retirer les ${q!.pending} fiche(s) en attente de la file IA ? Les propositions déjà faites restent.`)) return;
    try { const r = await postJson<{ removed: number }>("/api/ai/queue", { action: "clear" }); toast(`${r.removed} fiche(s) retirée(s) de la file IA.`); load(); } catch (e) { toastError(e); }
  }
  return (
    <div className="ai-progress" role="status" aria-live="polite">
      <div className="row spread">
        <span className="small"><span className="badge ai">IA</span> Préparation : <b>{q.done}</b> / {q.total} fiche(s){q.errors ? <span className="err"> · {q.errors} erreur(s)</span> : null}</span>
        {q.pending > 0 && <button type="button" className="btn sm ghost" onClick={clear}>Vider la file</button>}
      </div>
      {q.total > 0 && <div className="bar" aria-hidden><i style={{ width: pct + "%" }} /></div>}
      <span className="tiny muted">
        {q.state === "running" && q.current ? <>En cours : <b>{q.current.nom || "fiche #" + q.current.id}</b> (analyse puis message, une fiche à la fois).</>
          : q.state === "offline" ? <span className="warn-text">En pause : {q.message || "IA hors ligne"}. Reprise automatique dès que l'IA répond.</span>
          : q.state === "unconfigured" ? <span className="warn-text">En pause : {q.message || "IA non configurée (Réglages › IA)"}.</span>
          : q.pending ? "En attente du prochain passage (moins d'une minute)…" : "File vide."}
      </span>
      {q.lastError && <span className="tiny err">Dernière erreur : {q.lastError}</span>}
    </div>
  );
}
