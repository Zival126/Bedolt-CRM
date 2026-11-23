"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ResultPanel, { type PanelHandle } from "./ResultPanel";
import { OffreBadge, Stars } from "./Badges";
import { postJson } from "./client-api";
import { toastError, UNDO_EVENT } from "./Toast";
import type { QueueRow } from "@/lib/rows";

export type FocusRow = QueueRow & { web: string; maps: string; actions: { label: string; content: string; at: string }[] };
type Counts = { newWa: number; relances: number; replies: number };

const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "America/Cancun", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Un prospect à la fois ; après un résultat → le suivant (ordre de la file). « Passer » le remet en fin de file. */
export default function FocusView({ items, extra, counts: initial, goals, exitHref = "/", label }: {
  items: FocusRow[]; extra: FocusRow[]; counts: Counts; goals: { newGoal: number; newHard?: number; relances: number };
  /** Bouton « Quitter » (la Carte quand le focus porte sur ses fiches). */ exitHref?: string; label?: string;
}) {
  const router = useRouter();
  const [list, setList] = useState(items);
  const [more, setMore] = useState(extra);
  const [total, setTotal] = useState(items.length);
  const doneRef = useRef<FocusRow[]>([]);
  const [doneN, setDoneN] = useState(0);
  const [counts, setCounts] = useState(initial);
  const panel = useRef<PanelHandle>(null);
  const cur = list[0];

  // Annuler (toast) : la fiche revient en tête.
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ businessId?: number }>).detail?.businessId;
      const r = doneRef.current.find((x) => x.id === id);
      if (!r) return;
      doneRef.current = doneRef.current.filter((x) => x !== r);
      setDoneN(doneRef.current.length);
      setList((l) => [r, ...l.filter((x) => x.id !== id)]);
    };
    window.addEventListener(UNDO_EVENT, on);
    return () => window.removeEventListener(UNDO_EVENT, on);
  }, []);

  async function skip() {
    if (!cur) return;
    setList((l) => [...l.slice(1), l[0]]);
    if (cur.qid <= 0) return; // fiche hors file du jour (focus depuis la Carte) : rien à enregistrer
    try { await postJson("/api/queue/skip", { qid: cur.qid }); } catch (e) { toastError(e); }
  }
  function resolved(r: { counts?: Record<string, number> }) {
    if (r.counts) setCounts(r.counts as Counts);
    doneRef.current = [...doneRef.current, cur];
    setDoneN(doneRef.current.length);
    setList((l) => l.slice(1));
    window.scrollTo({ top: 0 });
  }

  // Raccourcis clavier (ordinateur) : W, R, N, P, →
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === "w") panel.current?.wa();
      else if (k === "r") panel.current?.repondu();
      else if (k === "n") panel.current?.pasRepondu();
      else if (k === "p") panel.current?.perdu();
      else if (e.key === "ArrowRight") skip();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const pos = Math.min(doneN + 1, total);
  // Limite dure du jour appliquée au fil de la session (les compteurs sont mis à jour après chaque résultat).
  const hardReached = goals.newHard != null && counts.newWa >= goals.newHard;
  if (!cur) {
    return (
      <div className="focus">
        <div className="focus-top"><Link href={exitHref} className="btn ghost" onClick={() => router.refresh()}>✕ Quitter</Link><span className="counter-pill">{doneN} / {total}</span><span /></div>
        <div className="focus-end card">
          <div style={{ fontSize: 44 }}>🎉</div>
          <h1>{total ? "File terminée" : "Rien à faire pour l'instant"}</h1>
          <p className="muted">{doneN} prospect{doneN > 1 ? "s" : ""} traité{doneN > 1 ? "s" : ""} · {counts.newWa}/{goals.newGoal} nouveaux WhatsApp · {counts.relances}/{goals.relances} relances · {counts.replies} réponse{counts.replies > 1 ? "s" : ""}</p>
          {more.length > 0 && <button className="btn primary big" onClick={() => { setList(more); setTotal((t) => t + more.length); setMore([]); }}>Continuer au-delà de l'objectif ({more.length})</button>}
          <Link href={exitHref} className="btn big" onClick={() => router.refresh()}>{exitHref === "/" ? "Retour à Aujourd'hui" : "Retour à la carte"}</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="focus">
      <div className="focus-top">
        <Link href={exitHref} className="btn ghost" onClick={() => router.refresh()}>✕ Quitter</Link>
        <span className="counter-pill" aria-label={label ?? "Position dans la file"} title={label}>{pos} / {total}</span>
        <button className="btn ghost" onClick={skip} disabled={list.length < 2} title="Remettre en fin de file (rien n'est journalisé)">Passer →</button>
      </div>
      <div className="focus-bar"><i style={{ width: (doneN / Math.max(1, total)) * 100 + "%" }} /></div>

      <article className="focus-card card" key={cur.qid}>
        <div className="row spread" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
          <h1 className="focus-name">{cur.nom}</h1>
          <span className={`stage stage-${cur.stage}`}>{cur.stageLabel}</span>
        </div>
        <div className="meta">{[cur.niche, cur.zone, cur.ville].filter(Boolean).join(" · ")}</div>
        <div className="row" style={{ gap: 6 }}>
          <OffreBadge o={cur.offre} /><Stars note={cur.note} avis={cur.avis} />
          {cur.web && <span className="badge">Web : {cur.web}</span>}
          <a className="badge link-badge" href={cur.maps} target="_blank" rel="noreferrer">Google Maps ↗</a>
          <Link className="badge link-badge" href={`/commerces/${cur.id}`}>Fiche</Link>
        </div>
        {cur.info && <p className="small muted" style={{ margin: 0 }}>{cur.info}</p>}
        {cur.angle && <div className="angle"><b>Angle</b> {cur.angle}</div>}

        <ResultPanel ref={panel} key={cur.qid} item={hardReached && cur.stage === "new" && !cur.panel.waBlocked
          ? { ...cur.panel, waBlocked: `Limite dure atteinte (${goals.newHard} nouveaux WhatsApp aujourd'hui) : reprends demain ou ajuste Réglages > Objectifs.` } : cur.panel} size="lg" editor={cur.panel.template ? "always" : "toggle"} onResolved={resolved} />

        <div className="history">
          <div className="small muted">Dernières actions</div>
          {cur.actions.length === 0 && <div className="small muted">Aucune action pour l'instant.</div>}
          {cur.actions.map((a, i) => <div key={i} className="small"><span className="muted">{fmt(a.at)}</span> · {a.label}{a.content ? ` — ${a.content}` : ""}</div>)}
        </div>
      </article>
      <p className="kbd-hints only-desk"><kbd>W</kbd> WhatsApp · <kbd>R</kbd> a répondu · <kbd>N</kbd> pas répondu · <kbd>P</kbd> perdu · <kbd>→</kbd> passer</p>
    </div>
  );
}
