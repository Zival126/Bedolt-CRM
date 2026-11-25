"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";

type Out = { status: string; draft_message: string; summary: string; improvements: string[]; priority: number | null; reason: string; model: string; at: string | null; used_at: string | null } | null;
const ST: Record<string, [string, string]> = { a_faire: ["À faire", "warn"], en_cours: ["En cours", "accent"], fait: ["Fait", "ok"], erreur: ["Erreur", "bad"] };

// Fiche : section IA. Affiche les propositions (vides tant que l'IA n'est pas branchée) ; rien n'est appliqué sans validation.
export default function AiPanel({ id, out, queued }: { id: number; out: Out; queued: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function act(action: "use" | "dismiss" | "prepare") {
    if (action === "use" && !confirm("Remplacer le message WhatsApp préparé de la fiche par ce message proposé par l'IA ?")) return;
    setBusy(true);
    try {
      await postJson("/api/ai/queue", action === "prepare" ? { action, ids: [id] } : { action, id });
      toast(action === "use" ? "Message utilisé ✓ (modifiable dans « Fiche »)." : action === "prepare" ? "Fiche ajoutée à la file IA (en pause)." : "Proposition ignorée.");
      router.refresh();
    } catch (e) { toastError(e); }
    setBusy(false);
  }
  const row = (l: string, v: React.ReactNode) => <><span className="muted">{l}</span><span>{v || <span className="muted">—</span>}</span></>;
  return (
    <div className="ai-box">
      <div className="row spread">
        <span className="row" style={{ gap: 6 }}><b>Propositions de l'IA</b>{out && <span className={"badge " + (ST[out.status]?.[1] ?? "")}>{ST[out.status]?.[0] ?? out.status}</span>}{queued && <span className="badge">dans la file</span>}</span>
        <span className="row" style={{ gap: 6 }}>
          <button type="button" className="btn sm" disabled title="IA non connectée">✨ Générer avec l'IA</button>
          {!queued && <button type="button" className="btn sm ghost" disabled={busy} onClick={() => act("prepare")}>Préparer avec l'IA</button>}
        </span>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>IA non connectée : la génération sera activée plus tard (Ollama ou n8n). L'IA proposera ; tu valides avant que quoi que ce soit change.</p>
      <div className="ai-field">
        {row("Message proposé", out?.draft_message && <span style={{ whiteSpace: "pre-wrap" }}>{out.draft_message}</span>)}
        {row("Résumé", out?.summary)}
        {row("À améliorer", out?.improvements?.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{out.improvements.map((x) => <li key={x}>{x}</li>)}</ul> : "")}
        {row("Priorité", out?.priority != null ? `${out.priority} / 100` : "")}
        {row("Raison", out?.reason)}
        {row("Modèle · date", out?.model ? `${out.model}${out.at ? " · " + new Date(out.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : ""}` : "")}
      </div>
      {out?.draft_message && <div className="row">
        <button type="button" className="btn sm primary" disabled={busy} onClick={() => act("use")}>Utiliser ce message</button>
        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => act("dismiss")}>Ignorer</button></div>}
      <a className="tiny" href={`/api/ai/context?id=${id}`} target="_blank" rel="noreferrer">Voir le dossier IA de la fiche (JSON) ↗</a>
    </div>
  );
}
