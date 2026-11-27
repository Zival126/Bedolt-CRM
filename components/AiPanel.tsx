"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getJson, postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import { useAiStatus, aiBlockedReason } from "./ai-status";
import { queueChanged } from "./AiQueueProgress";

type Out = { status: string; draft_message: string; summary: string; improvements: string[]; priority: number | null; reason: string; model: string; error: string; at: string | null; used_at: string | null } | null;
const ST: Record<string, [string, string]> = { a_faire: ["À faire", "warn"], en_cours: ["En cours", "accent"], fait: ["Fait", "ok"], erreur: ["Erreur", "bad"] };

// Fiche : section IA. « Générer » / « Régénérer » lancent l'analyse puis le message ; tout reste une PROPOSITION :
// « Utiliser ce message » (clic + confirmation) remplit le message WhatsApp de la fiche. Rien n'est envoyé.
type FState = { pending: boolean; running: boolean; ahead: number; task: "analyse" | "message" | null; tokens: number; reasoning: number; elapsedS: number; worker: string; message: string; lastResult: string | null };
type View = { state: FState; output: Out & { error?: string } };

export default function AiPanel({ id, out, queued }: { id: number; out: Out; queued: boolean }) {
  const router = useRouter();
  const ai = useAiStatus();
  const blocked = aiBlockedReason(ai);
  const [busy, setBusy] = useState<"" | "gen" | "act">("");
  const [st, setSt] = useState<FState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watching = useRef(false);
  // Suivi de la génération en arrière-plan (file IA) : relu toutes les 2 s tant que la fiche est en file ou en cours.
  const poll = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const v = await getJson<View>(`/api/ai/prepare?id=${id}`);
      setSt(v.state);
      if (v.state.pending || v.state.running) { watching.current = true; timer.current = setTimeout(poll, 2000); return; }
      if (watching.current) {
        watching.current = false;
        if (v.state.lastResult === "erreur" || v.output?.status === "erreur") toast("La génération a échoué : " + (v.output?.error || "voir Réglages › IA › journal"), { kind: "err" });
        else toast("Analyse et brouillon prêts ✓ — relis-les avant de les utiliser.");
        router.refresh();
      }
    } catch { timer.current = setTimeout(poll, 5000); }
  }, [id, router]);
  useEffect(() => { if (queued || out?.status === "en_cours") poll(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [poll, queued, out?.status]);
  async function generate() {
    setBusy("gen");
    try { const r = await postJson<View & { already: boolean }>("/api/ai/prepare", { id }); setSt(r.state); watching.current = true; toast(r.already ? "Déjà en cours de préparation." : "Génération lancée en arrière-plan : tu peux continuer à travailler."); queueChanged(); poll(); }
    catch (e) { toastError(e); }
    setBusy("");
  }
  async function act(action: "use" | "dismiss" | "prepare") {
    if (action === "use" && !confirm("Remplacer le message WhatsApp préparé de la fiche par ce message proposé par l'IA ?")) return;
    setBusy("act");
    try {
      const r = await postJson<{ added?: number }>("/api/ai/queue", action === "prepare" ? { action, ids: [id] } : { action, id });
      toast(action === "use" ? "Message utilisé ✓ (modifiable dans « Fiche »)." : action === "prepare" ? (r.added ? "Fiche ajoutée à la file IA." : "Déjà préparée il y a moins de 30 jours (utilise « Régénérer »).") : "Proposition ignorée.");
      if (action === "prepare") queueChanged();
      router.refresh();
    } catch (e) { toastError(e); }
    setBusy("");
  }
  const row = (l: string, v: React.ReactNode) => <><span className="muted">{l}</span><span>{v || <span className="muted">—</span>}</span></>;
  const has = !!(out && (out.summary || out.draft_message));
  const active = !!st && (st.pending || st.running) || busy === "gen";
  return (
    <div className="ai-box">
      <div className="row spread">
        <span className="row" style={{ gap: 6 }}><b>Propositions de l'IA</b>{out && <span className={"badge " + (ST[out.status]?.[1] ?? "")}>{active ? "En cours" : ST[out.status]?.[0] ?? out.status}</span>}{(st ? st.pending && !st.running : queued) && <span className="badge">dans la file</span>}</span>
        <span className="row" style={{ gap: 6 }}>
          <button type="button" className="btn sm primary-soft" disabled={!!busy || !!blocked || active} title={blocked ?? "Analyse puis brouillon de message, en arrière-plan (tu peux quitter la page)"} onClick={generate}>
            {active ? "Génération…" : has ? "↻ Régénérer" : "✨ Générer"}</button>
          {!queued && !active && <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => act("prepare")} title="Ajouter à la file IA (traitée en arrière-plan, une fiche à la fois)">Ajouter à la file IA</button>}
        </span>
      </div>
      {blocked && <p className="ai-off-note">{blocked}</p>}
      {st?.running && <p className="small" role="status" style={{ margin: 0 }}><span className="badge ai">IA</span> Génération en cours… <b>{st.task === "message" ? "message" : "analyse"}</b> · <b>{st.tokens}</b> tokens reçus{st.reasoning ? ` (dont ${st.reasoning} de raisonnement)` : ""} · {st.elapsedS} s</p>}
      {st && st.pending && !st.running && <p className="small muted" role="status" style={{ margin: 0 }}>{st.worker === "offline" || st.worker === "unconfigured" ? <span className="warn-text">En attente : {st.message || "IA hors ligne"}.</span> : st.ahead ? `En file : ${st.ahead} fiche(s) avant celle-ci.` : "Démarrage de la génération…"}</p>}
      {out?.status === "erreur" && out.error && <p className="small err" style={{ margin: 0 }}>Erreur : {out.error}</p>}
      <div className="ai-field">
        {row("Message proposé", out?.draft_message && <span style={{ whiteSpace: "pre-wrap" }}>{out.draft_message}</span>)}
        {row("Résumé", out?.summary)}
        {row("À améliorer", out?.improvements?.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{out.improvements.map((x) => <li key={x}>{x}</li>)}</ul> : "")}
        {row("Priorité", out?.priority != null ? `${out.priority} / 100` : "")}
        {row("Raison", out?.reason)}
        {row("Modèle · date", out?.model ? `${out.model}${out.at ? " · " + new Date(out.at).toLocaleString("fr-FR", { timeZone: "America/Cancun", dateStyle: "short", timeStyle: "short" }) : ""}` : "")}
        {out?.used_at && !out.draft_message ? row("Validation", "proposition ignorée") : out?.used_at ? row("Validation", "message utilisé dans la fiche le " + new Date(out.used_at).toLocaleDateString("fr-FR")) : null}
      </div>
      {out?.draft_message && <div className="row">
        <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => act("use")}>Utiliser ce message</button>
        <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => act("dismiss")}>Ignorer</button>
        <span className="tiny muted">« Utiliser » remplit le message WhatsApp de la fiche ; rien n'est envoyé.</span></div>}
      <a className="tiny" href={`/api/ai/context?id=${id}`} target="_blank" rel="noreferrer">Voir le dossier IA de la fiche (JSON) ↗</a>
    </div>
  );
}
