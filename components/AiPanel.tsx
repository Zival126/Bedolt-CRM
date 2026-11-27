"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import { useAiStatus, aiBlockedReason } from "./ai-status";
import { queueChanged } from "./AiQueueProgress";

type Out = { status: string; draft_message: string; summary: string; improvements: string[]; priority: number | null; reason: string; model: string; error: string; at: string | null; used_at: string | null } | null;
const ST: Record<string, [string, string]> = { a_faire: ["À faire", "warn"], en_cours: ["En cours", "accent"], fait: ["Fait", "ok"], erreur: ["Erreur", "bad"] };

// Fiche : section IA. « Générer » / « Régénérer » lancent l'analyse puis le message ; tout reste une PROPOSITION :
// « Utiliser ce message » (clic + confirmation) remplit le message WhatsApp de la fiche. Rien n'est envoyé.
export default function AiPanel({ id, out, queued }: { id: number; out: Out; queued: boolean }) {
  const router = useRouter();
  const ai = useAiStatus();
  const blocked = aiBlockedReason(ai);
  const [busy, setBusy] = useState<"" | "gen" | "act">("");
  async function generate() {
    setBusy("gen");
    try { await postJson("/api/ai/prepare", { id }); toast("Analyse et brouillon prêts ✓ — relis-les avant de les utiliser."); router.refresh(); }
    catch (e) { toastError(e); router.refresh(); }
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
  return (
    <div className="ai-box">
      <div className="row spread">
        <span className="row" style={{ gap: 6 }}><b>Propositions de l'IA</b>{out && <span className={"badge " + (ST[out.status]?.[1] ?? "")}>{busy === "gen" ? "En cours" : ST[out.status]?.[0] ?? out.status}</span>}{queued && <span className="badge">dans la file</span>}</span>
        <span className="row" style={{ gap: 6 }}>
          <button type="button" className="btn sm primary-soft" disabled={!!busy || !!blocked || out?.status === "en_cours"} title={blocked ?? "Analyse puis brouillon de message (≈ 30 s à 2 min)"} onClick={generate}>
            {busy === "gen" ? "Génération…" : has ? "↻ Régénérer" : "✨ Générer"}</button>
          {!queued && <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => act("prepare")} title="Ajouter à la file IA (traitée en arrière-plan, une fiche à la fois)">Ajouter à la file IA</button>}
        </span>
      </div>
      {blocked && <p className="ai-off-note">{blocked}</p>}
      {busy === "gen" && <p className="tiny muted" style={{ margin: 0 }}>L'IA analyse la fiche, puis rédige le message… (modèle local : compte 30 s à 2 min)</p>}
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
