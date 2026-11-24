"use client";
import { useActionState } from "react";

export type FormResult = { ok?: string; error?: string } | void;

/**
 * Formulaire branché sur une server action qui renvoie { ok } ou { error } : le message s'affiche sous le formulaire
 * (plus d'action invalide silencieuse). Les redirections de l'action fonctionnent normalement.
 */
export default function ActionForm({ action, children, className, style, submit, submitClass = "btn primary" }: {
  action: (fd: FormData) => Promise<FormResult>; children: React.ReactNode; className?: string; style?: React.CSSProperties; submit?: string; submitClass?: string;
}) {
  const [state, run, pending] = useActionState(async (_: FormResult, fd: FormData) => (await action(fd)) ?? { ok: "Enregistré." }, undefined);
  return (
    <form action={run} className={className} style={style} aria-busy={pending}>
      {children}
      {submit && <div className="row" style={{ marginTop: 12 }}><button className={submitClass} disabled={pending}>{pending ? "…" : submit}</button>
        {state?.ok && <span className="saved" role="status">Enregistré ✓</span>}</div>}
      {!submit && state?.ok && <p className="small ok" role="status">✓ {state.ok}</p>}
      {state?.error && <p className="small err" role="alert">⚠️ {state.error}</p>}
    </form>
  );
}
