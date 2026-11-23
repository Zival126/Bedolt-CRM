"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "./client-api";

// Toasts globaux : confirmation d'action avec « Annuler » (10 s) et erreurs visibles.
type T = { id: number; message: string; undo?: number; kind: "ok" | "err"; businessId?: number };
type Listener = (t: T) => void;
let listener: Listener | null = null;
let seq = 0;
export function toast(message: string, opts: { undo?: number; kind?: "ok" | "err"; businessId?: number } = {}) {
  listener?.({ id: ++seq, message, undo: opts.undo, kind: opts.kind ?? "ok", businessId: opts.businessId });
}
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), { kind: "err" });
/** Événement émis après une annulation réussie (le mode focus revient sur la fiche). */
export const UNDO_EVENT = "bedolt-undo";

export function Toaster() {
  const router = useRouter();
  const [items, setItems] = useState<T[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    listener = (t) => {
      setItems((l) => [...l.slice(-2), t]);
      timers.current.set(t.id, setTimeout(() => setItems((l) => l.filter((x) => x.id !== t.id)), t.kind === "err" ? 8000 : 10_000));
    };
    return () => { listener = null; };
  }, []);
  const close = (id: number) => { clearTimeout(timers.current.get(id)); setItems((l) => l.filter((x) => x.id !== id)); };
  async function undo(t: T) {
    close(t.id);
    try {
      const r = await postJson<{ message: string }>("/api/undo", { undo: t.undo });
      toast(r.message);
      window.dispatchEvent(new CustomEvent(UNDO_EVENT, { detail: { businessId: t.businessId } }));
      router.refresh();
    } catch (e) { toastError(e); }
  }
  if (!items.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={"toast" + (t.kind === "err" ? " err" : "")}>
          <span>{t.kind === "err" ? "⚠️ " : ""}{t.message}</span>
          <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
            {t.undo && <button className="btn sm ghost" onClick={() => undo(t)}>Annuler</button>}
            <button className="btn sm ghost icon" aria-label="Fermer" onClick={() => close(t.id)}>✕</button>
          </span>
          {t.kind === "ok" && t.undo ? <i className="toast-timer" /> : null}
        </div>
      ))}
    </div>
  );
}
