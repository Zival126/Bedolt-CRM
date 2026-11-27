"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import type { WebAuditRow } from "@/lib/web-audit";

const fmt = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
export const scoreClass = (s: number | null) => (s == null ? "" : s >= 70 ? "ok" : s >= 50 ? "warn" : "bad");

// Fiche : analyse de présence web (score, points à améliorer) ; « Aucun site » = opportunité.
export default function WebAuditPanel({ id, site, initial }: { id: number; site: string; initial: WebAuditRow | null }) {
  const router = useRouter();
  const [a, setA] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try { const r = await postJson<{ audit: WebAuditRow | null }>("/api/web-audit", { action: "one", id }); setA(r.audit); router.refresh(); } catch (e) { toastError(e); }
    setBusy(false);
  }
  async function useFinal() {
    if (!a || !confirm(`Remplacer le site de la fiche par ${a.finalSite} ?`)) return;
    try { const r = await postJson<{ site: string; audit: WebAuditRow | null }>("/api/web-audit", { action: "use_final", id }); setA(r.audit); toast("Site de la fiche mis à jour ✓"); router.refresh(); } catch (e) { toastError(e); }
  }
  const FAIL: Record<string, string> = { injoignable: "Injoignable — à vérifier", robots: "Analyse interdite (robots.txt) — à vérifier", bloque: "Adresse refusée — à vérifier" };
  if (!site) return (
    <div className="banner warn" style={{ fontWeight: 500 }}><b>Aucun site</b> : c'est une opportunité (proposer un site ou une page simple avec WhatsApp et réservation).</div>
  );
  const d = a?.data;
  const yes = (ok: boolean | undefined, l: string) => <li className={ok ? "ok" : "err"}>{ok ? "✓" : "✗"} {l}</li>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row spread">
        <span className="row" style={{ gap: 8 }}>
          {a ? (a.status === "ok" && a.score != null ? <span className={"badge " + scoreClass(a.score)} style={{ fontSize: 14, padding: "3px 12px" }}>Score web {a.score} / 100</span>
            : <span className="badge warn" title="Pas de score : le site n'a pas pu être analysé (ce n'est pas « aucun site »)">{FAIL[a.status] ?? "À vérifier"}</span>)
            : <span className="badge">Pas encore analysé</span>}
          {d?.platform && <span className="badge">{d.platform}</span>}
          {d?.branches ? <span className="badge">{d.branches} établissements</span> : null}
          {d?.suspect?.length ? <span className="badge bad" title={d.suspect.join(", ")}>⚠ contenu suspect</span> : null}
          {a && <span className="tiny muted">le {fmt(a.at)}</span>}
        </span>
        <button type="button" className="btn sm" disabled={busy} onClick={run}>{busy ? "Analyse…" : a ? "Ré-analyser le site" : "Analyser le site"}</button>
      </div>
      {a?.domainChanged && (
        <div className="banner warn row spread" style={{ gap: 8 }}>
          <span className="small">Le site redirige vers <b>{a.finalSite}</b> (autre domaine que celui de la fiche).</span>
          <button type="button" className="btn sm" onClick={useFinal}>Mettre à jour le site de la fiche</button>
        </div>
      )}
      {a && a.status !== "ok" && <p className="small muted" style={{ margin: 0 }}>Pas de score : le site n'a pas répondu à l'analyse (20 s max, 5 redirections, 2 essais). Ouvre-le toi-même pour vérifier ; ce n'est pas compté comme « aucun site » ni comme un mauvais score.</p>}
      {d && (
        <ul className="audit-list">
          {yes(d.https, "HTTPS")}{yes(d.viewport, "Adapté au téléphone")}{yes(d.ms != null && d.ms < 3000, `Rapide${d.ms != null ? ` (${(d.ms / 1000).toFixed(1)} s)` : ""}`)}
          {yes(!!d.title, "Titre")}{yes(!!d.description, "Description Google")}{yes(d.whatsapp || d.tel, d.whatsapp ? "Bouton WhatsApp" : "Téléphone cliquable")}
          {yes(d.form || d.booking, d.booking ? "Réservation en ligne" : "Formulaire")}{yes(d.socials.length > 0, d.socials.length ? d.socials.join(", ") : "Réseaux sociaux")}
          <li className="muted">{d.copyright ? `© ${d.copyright}` : "Pas de date visible"} · {d.pages} page(s) trouvée(s)</li>
        </ul>
      )}
      {a && a.issues.length > 0 && (
        <div><b className="small">À améliorer</b><ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{a.issues.map((x) => <li key={x}>{x}</li>)}</ul></div>
      )}
      <span className="tiny muted">Analyse automatique sans IA (page d'accueil + contact, mêmes règles de sécurité que l'enrichissement). Le texte du site est gardé pour l'IA comme une donnée, jamais comme une consigne.</span>
    </div>
  );
}

/** Lancement en lot (Réglages > Sources & clés). */
export function WebAuditCard({ initial }: { initial: { total: number; done: number; pending: number; eligible: number; audited: number; low: number; nosite: number; enabled: boolean } }) {
  const [s, setS] = useState(initial);
  async function start() {
    try { const r = await postJson<{ added: number; status: typeof initial }>("/api/web-audit", { action: "queue", all: true }); setS(r.status); } catch (e) { toastError(e); }
  }
  return (
    <div className="card stack" style={{ gap: 6 }}>
      <div className="row spread"><b className="small">Analyse des sites (score web)</b>
        <button type="button" className="btn sm" disabled={!s.enabled || !s.eligible || s.pending > 0} onClick={start}>Analyser les sites{s.eligible ? ` (${s.eligible})` : ""}</button></div>
      <span className="small">{s.audited} site(s) analysé(s) · <b>{s.low}</b> avec un score &lt; 50 · <b>{s.nosite}</b> fiche(s) sans site.</span>
      {s.pending > 0 && <span className="tiny muted">En cours : {s.done} / {s.total} (continue sur le serveur, 1 requête / seconde par site).</span>}
      {!s.enabled && <span className="tiny warn-text">Analyse désactivée sur ce serveur (WEBAUDIT=off).</span>}
    </div>
  );
}
