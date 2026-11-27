"use client";
// État « IA en ligne / hors ligne » côté navigateur : lu sur /api/ai/status (le serveur garde un cache de 60 s),
// partagé entre les composants de la page. Aucune requête vers l'IA depuis le navigateur.
import { useEffect, useState } from "react";

export type AiState = { online: boolean; configured: boolean; provider: string; model: string; message: string };
const EVENT = "bedolt:ai-status";
let cache: { at: number; v: AiState } | null = null;
let inflight: Promise<AiState> | null = null;

export const OFFLINE_HELP = "IA hors ligne : ton PC est éteint ou LM Studio n'est pas lancé. Le CRM fonctionne normalement ; les boutons IA reviennent quand l'IA répond.";

export function loadAiStatus(fresh = false): Promise<AiState> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return Promise.resolve(cache.v);
  if (inflight && !fresh) return inflight;
  inflight = fetch("/api/ai/status" + (fresh ? "?fresh=1" : ""), { cache: "no-store" }).then((r) => r.json())
    .then((v: AiState) => { cache = { at: Date.now(), v }; window.dispatchEvent(new CustomEvent(EVENT, { detail: v })); return v; })
    .catch(() => ({ online: false, configured: false, provider: "", model: "", message: "Statut IA illisible." }))
    .finally(() => { inflight = null; });
  return inflight;
}
/** Diffuse un état déjà connu (ex. la navigation l'a reçu avec ses compteurs). */
export function publishAiStatus(v: Pick<AiState, "online" | "configured" | "message">) {
  const full = { provider: cache?.v.provider ?? "", model: cache?.v.model ?? "", ...v };
  cache = { at: Date.now(), v: full };
  window.dispatchEvent(new CustomEvent(EVENT, { detail: full }));
}

/** null tant que l'état n'est pas connu. */
export function useAiStatus(): AiState | null {
  const [s, setS] = useState<AiState | null>(cache?.v ?? null);
  useEffect(() => {
    const on = (e: Event) => setS((e as CustomEvent<AiState>).detail);
    window.addEventListener(EVENT, on);
    loadAiStatus().then(setS);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return s;
}
/** Explication à afficher sous un bouton IA grisé (null : bouton actif). */
export const aiBlockedReason = (s: AiState | null): string | null =>
  !s ? null : s.online ? null : !s.configured ? (s.message || "IA non configurée : Réglages › IA.") : OFFLINE_HELP;
