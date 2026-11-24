"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleDnc } from "@/app/actions";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";

/** Fiche : « Ne pas contacter » (marquer / retirer). */
export function DncToggle({ id, on }: { id: number; on: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = () => {
    if (!on && !confirm("Marquer « Ne pas contacter » ? La fiche sort de toutes les files, de la carte (par défaut) et des envois WhatsApp.")) return;
    start(async () => { const r = await toggleDnc(id, !on); if (r.error) toast(r.error, { kind: "err" }); else toast(r.ok ?? ""); router.refresh(); });
  };
  return <button type="button" className={"btn sm" + (on ? " ok" : " danger")} disabled={pending} onClick={go}>{on ? "Retirer « Ne pas contacter »" : "⛔ Ne pas contacter"}</button>;
}

/** Fiche DENUE : « Mettre à jour depuis DENUE » (méthode Ficha, côté serveur). */
export function DenueRefresh({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { const r = await postJson<{ message: string }>("/api/denue/refresh", { id }); toast(r.message); router.refresh(); } catch (e) { toastError(e); }
    setBusy(false);
  }
  return <button type="button" className="btn sm" disabled={busy} onClick={go}>{busy ? "DENUE…" : "↻ Mettre à jour depuis DENUE"}</button>;
}

/** Fiche : « Enrichir maintenant » (site web → email, réseaux, WhatsApp). */
export function EnrichNow({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { const r = await postJson<{ detail: string }>("/api/enrich", { action: "one", id }); toast(r.detail); router.refresh(); } catch (e) { toastError(e); }
    setBusy(false);
  }
  return <button type="button" className="btn sm" disabled={busy} onClick={go}>{busy ? "Lecture du site…" : "↻ Enrichir depuis le site"}</button>;
}

/** Fiche : « Vérifier sur Google » (Google Places, seulement si la clé est configurée). */
export function GoogleCheck({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { const r = await postJson<{ message: string; filled: string[] }>("/api/google", { id }); toast(r.message + (r.filled.length ? ` Mis à jour : ${r.filled.join(", ")}.` : "")); router.refresh(); }
    catch (e) { toastError(e); }
    setBusy(false);
  }
  return <button type="button" className="btn sm" disabled={busy} onClick={go}>{busy ? "Google…" : "Vérifier sur Google"}</button>;
}
