"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ResultPanel from "./ResultPanel";
import { OffreBadge, Stars } from "./Badges";
import { NicheBadge, PageHead, Empty, fmtN } from "./ui";
import NicheChips from "./NicheChips";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import AiQueueProgress, { queueChanged } from "./AiQueueProgress";
import { useAiStatus } from "./ai-status";
import type { QueueRow } from "@/lib/rows";
import type { NicheLite } from "@/lib/niche-style";
import type { QueueFilter } from "@/lib/settings";

type BlockData = { items: QueueRow[]; extra: QueueRow[]; goal: number | null; done: number; total: number };
type Plan = {
  filter: QueueFilter; isDay: boolean; relances: boolean; defaultFilter: QueueFilter; matching: number; ready: Record<number, number>;
  options: { villes: string[]; zones: string[]; offres: string[]; sources: string[] }; picked: number; hardLeft: number; hard: number;
};
type Props = {
  day: string; counts: { newWa: number; relances: number; replies: number; calls: number };
  goals: { newGoal: number; newHard: number; relances: number };
  blocks: { reponses: BlockData; relances: BlockData; nouveaux: BlockData };
  toCall: number; toContact: number; denueNew?: number; niches: NicheLite[]; allNiches: NicheLite[]; plan: Plan;
};

const SRC: Record<string, string> = { excel: "Excel / Gemini", denue: "DENUE", osm: "OpenStreetMap", overture: "Overture", manuel: "Saisie manuelle", google: "Google", foursquare: "Foursquare", here: "HERE", tomtom: "TomTom" };
const longDay = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

function Progress({ label, n, goal, hard }: { label: string; n: number; goal?: number; hard?: number }) {
  const max = Math.max(goal ?? 0, hard ?? 0, n, 1);
  const reached = goal !== undefined && goal > 0 && n >= goal;
  return (
    <div className="prog">
      <div className="row spread"><span className="small muted">{label}</span>
        <b className={reached ? "ok" : ""}>{n}{goal !== undefined ? <span className="muted"> / {goal}</span> : null}{reached ? " 🎉" : ""}</b></div>
      {goal !== undefined && (
        <div className={"bar" + (reached ? " full" : "") + (hard && n >= hard ? " hard" : "")}>
          <i style={{ width: Math.min(100, (n / max) * 100) + "%" }} />
          {hard && hard > (goal ?? 0) && <em style={{ left: ((goal ?? 0) / max) * 100 + "%" }} title="objectif" />}
        </div>
      )}
      {hard !== undefined && <div className="tiny muted">limite dure {hard}</div>}
    </div>
  );
}

export function RowCard({ r, onResolved, niche }: { r: QueueRow; onResolved: () => void; niche?: NicheLite | null }) {
  return (
    <article className={`qrow st-${r.stage}`}>
      <div className="qinfo">
        <div className="row spread" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
          <Link href={`/commerces/${r.id}`} className="t">{r.nom}</Link>
          <span className={`stage stage-${r.stage}`}>{r.stageLabel}</span>
        </div>
        <div className="row" style={{ gap: 6 }}><NicheBadge n={niche} small /><span className="meta">{[r.zone, r.ville].filter(Boolean).join(" · ")}</span></div>
        <div className="row" style={{ gap: 6 }}><OffreBadge o={r.offre} /><Stars note={r.note} avis={r.avis} />{r.panel.aiDraft && <span className="badge ai" title="Brouillon de message préparé par l'IA (modifiable avant l'envoi)">IA</span>}{r.info && <span className="small muted">{r.info}</span>}</div>
        {r.angle && <div className="angle line1" title={r.angle}>{r.angle}</div>}
      </div>
      <ResultPanel key={r.id + r.stage} item={r.panel} onResolved={onResolved} />
    </article>
  );
}

function Block({ n, title, lead, data, empty, onResolved, goalLabel, nicheOf }: {
  n: number; title: string; lead: string; data: BlockData; empty: React.ReactNode; onResolved: () => void; goalLabel?: string; nicheOf: (id: number | null) => NicheLite | null;
}) {
  const reached = data.goal !== null && data.done >= data.goal && data.goal > 0;
  const [more, setMore] = useState(false);
  const shown = more || reached ? (more ? [...data.items, ...data.extra] : []) : data.items;
  return (
    <section className="block">
      <header className="row spread">
        <div><h2><span className="num">{n}</span>{title} <span className="count">{data.items.length + data.extra.length}</span></h2><p className="tiny muted" style={{ margin: "2px 0 0 30px" }}>{lead}</p></div>
        {data.goal !== null && <span className="small muted">{data.done} / {data.goal} {goalLabel}</span>}
      </header>
      {reached && (
        <div className="goal-ok">
          <b>Objectif atteint 🎉</b>
          {data.extra.length > 0
            ? <button className="btn sm" onClick={() => setMore(!more)}>{more ? "Replier" : `En faire plus (${data.extra.length})`}</button>
            : <span className="small muted">Rien de plus possible aujourd'hui{goalLabel?.includes("WhatsApp") ? " (limite dure)" : ""}.</span>}
        </div>
      )}
      {!reached && data.items.length === 0 && data.extra.length === 0 && <div className="empty">{empty}</div>}
      <div className="list">{shown.map((r) => <RowCard key={r.qid} r={r} onResolved={onResolved} niche={nicheOf(r.nicheId)} />)}</div>
      {!reached && data.extra.length > 0 && (
        <button className="btn ghost wide" onClick={() => setMore(!more)}>{more ? "Replier" : `+ ${data.extra.length} au-delà de l'objectif`}</button>
      )}
    </section>
  );
}

/** « Ma journée » : choisir qui contacter aujourd'hui (remplace le filtre par défaut de Réglages pour ce jour). */
function DayPlan({ plan, niches, preview, onStart, startCount }: { plan: Plan; niches: NicheLite[]; preview: React.ReactNode; onStart: string; startCount: number }) {
  const router = useRouter();
  const [f, setF] = useState<QueueFilter>(plan.filter);
  const [rel, setRel] = useState(plan.relances);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(f.zones.length + f.offres.length + f.sources.length > 0);
  const ai = useAiStatus();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (next: QueueFilter, relances = rel) => {
    setF(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setBusy(true);
      try { await postJson("/api/day", { action: "filter", filter: next, relances }); router.refresh(); } catch (e) { toastError(e); }
      setBusy(false);
    }, 350);
  };
  async function reset() {
    setBusy(true);
    try { await postJson("/api/day", { action: "reset" }); setF(plan.defaultFilter); setRel(false); router.refresh(); toast("File recalculée avec tes réglages par défaut."); } catch (e) { toastError(e); }
    setBusy(false);
  }
  const multi = (k: "villes" | "zones" | "offres", vals: string[]) => vals.length === 0 ? null : (
    <div className="ms">{vals.slice(0, 40).map((v) => { const on = f[k].includes(v); return (
      <button type="button" key={v} className={"sm" + (on ? " on" : "")} aria-pressed={on} onClick={() => save({ ...f, [k]: on ? f[k].filter((x) => x !== v) : [...f[k], v] })}>{v}</button>); })}</div>);
  const nActive = f.nicheIds.length + f.villes.length + f.zones.length + f.offres.length + f.sources.length + (f.wa ? 1 : 0) + (f.email ? 1 : 0) + (f.webscore ? 1 : 0);
  return (
    <section className="card day-card" aria-labelledby="day-t">
      <div className="row spread">
        <div><h2 id="day-t" className="step-t" style={{ fontSize: 17 }}>Ma journée</h2>
          <p className="small muted" style={{ margin: 0 }}>{plan.isDay ? "Sélection du jour (tes réglages par défaut sont gardés pour demain)." : "Réglages par défaut. Choisis des niches ou des villes pour cibler ta journée."}</p></div>
        {plan.isDay && <button type="button" className="btn sm ghost" disabled={busy} onClick={reset}>Revenir à mes réglages par défaut</button>}
      </div>
      <div className="fsec"><b>Niches</b>
        <NicheChips niches={niches} value={f.nicheIds} counts={plan.ready} withNone onChange={(v) => save({ ...f, nicheIds: v })} /></div>
      {plan.options.villes.length > 0 && <div className="fsec"><b>Villes</b>{multi("villes", plan.options.villes)}</div>}
      <div className="ms">
        <button type="button" className={"sm" + (f.wa ? " on" : "")} aria-pressed={f.wa} onClick={() => save({ ...f, wa: !f.wa })}>WhatsApp confirmé</button>
        <button type="button" className={"sm" + (f.email ? " on" : "")} aria-pressed={f.email} onClick={() => save({ ...f, email: !f.email })}>A un email</button>
        <button type="button" className={"sm" + (f.webscore === "nosite" ? " on" : "")} aria-pressed={f.webscore === "nosite"} onClick={() => save({ ...f, webscore: f.webscore === "nosite" ? "" : "nosite" })}>Aucun site</button>
        <button type="button" className={"sm" + (f.webscore === "lt50" ? " on" : "")} aria-pressed={f.webscore === "lt50"} onClick={() => save({ ...f, webscore: f.webscore === "lt50" ? "" : "lt50" })}>Site faible (&lt; 50)</button>
        <button type="button" className="sm" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Moins de critères" : "Zone, offre, source…"}</button>
      </div>
      {more && <>
        {plan.options.zones.length > 0 && <div className="fsec"><b>Zones</b>{multi("zones", plan.options.zones)}</div>}
        {plan.options.offres.length > 0 && <div className="fsec"><b>Offre</b>{multi("offres", plan.options.offres)}</div>}
        {plan.options.sources.length > 1 && <div className="fsec"><b>Source</b>
          <div className="ms">{plan.options.sources.filter((s) => s in SRC).map((s) => { const k = s as QueueFilter["sources"][number]; const on = f.sources.includes(k); return (
            <button type="button" key={s} className={"sm" + (on ? " on" : "")} aria-pressed={on} onClick={() => save({ ...f, sources: on ? f.sources.filter((x) => x !== k) : [...f.sources, k] })}>{SRC[s]}</button>); })}</div></div>}
        <label className="chk small"><input type="checkbox" checked={rel} onChange={(e) => { setRel(e.target.checked); save(f, e.target.checked); }} />Filtrer aussi les relances et les réponses</label>
      </>}
      <div className="day-preview" aria-live="polite">
        <div className="grow">{preview}<div className="tiny muted">{fmtN(plan.matching)} prospect(s) joignable(s) correspondent{nActive ? ` à ces ${nActive} critère(s)` : ""}{busy ? " · mise à jour…" : ""}</div></div>
        <span className="row" style={{ gap: 6 }}>
          <button type="button" className="btn ghost" title={ai && !ai.online ? "IA hors ligne : les fiches attendront dans la file et seront préparées quand l'IA reviendra." : "Analyse + brouillon du premier message pour les fiches de ta file (une à la fois, en arrière-plan)"} onClick={async () => {
            try { const r = await postJson<{ added: number; skipped: number }>("/api/ai/queue", { action: "prepare", today: true });
              toast(`${r.added} fiche(s) ajoutée(s) à la file IA${r.skipped ? ` · ${r.skipped} déjà prête(s)` : ""}${ai && !ai.online ? " (en attente : IA hors ligne)" : ""}.`); queueChanged(); } catch (e) { toastError(e); } }}>✨ Préparer avec l'IA</button>
          <Link href={onStart} className={"btn primary" + (startCount ? "" : " off")} aria-disabled={!startCount}>▶ Démarrer{startCount ? ` (${startCount})` : ""}</Link>
        </span>
      </div>
    </section>
  );
}

export default function TodayView({ day, counts, goals, blocks, toCall, toContact, denueNew = 0, niches, allNiches, plan }: Props) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const byId = useMemo(() => new Map(allNiches.map((n) => [n.id, n])), [allNiches]);
  const nicheOf = (id: number | null) => (id ? byId.get(id) ?? null : null);
  const focusCount = blocks.reponses.items.length + blocks.relances.items.length + blocks.nouveaux.items.length;
  // Aperçu : « 20 nouveaux prêts : 12 Beauté, 8 Barbiers — Cancún »
  const nouveaux = blocks.nouveaux.items;
  const groups = new Map<number, number>();
  for (const r of nouveaux) groups.set(r.nicheId ?? 0, (groups.get(r.nicheId ?? 0) ?? 0) + 1);
  const villes = [...new Set(nouveaux.map((r) => r.ville).filter(Boolean))];
  const preview = nouveaux.length ? (
    <div className="row" style={{ gap: 6 }}>
      <span><span className="big-n">{nouveaux.length}</span> nouveau{nouveaux.length > 1 ? "x" : ""} prêt{nouveaux.length > 1 ? "s" : ""} :</span>
      {[...groups].sort((a, b) => b[1] - a[1]).map(([id, n]) => <NicheBadge key={id} n={nicheOf(id)} count={n} small />)}
      {villes.length > 0 && <span className="small muted">— {villes.slice(0, 3).join(", ")}{villes.length > 3 ? ` +${villes.length - 3}` : ""}</span>}
    </div>
  ) : plan.hardLeft <= 0 ? <b>Limite du jour atteinte ({plan.hard} nouveaux WhatsApp) : traite les réponses et relances, la suite demain.</b>
    : <b>Aucun nouveau prospect prêt avec cette sélection.</b>;
  return (
    <>
      <PageHead title="Aujourd'hui" lead={<>{longDay(day)} · choisis qui tu contactes, puis traite ta file : réponses, relances, nouveaux.</>}
        actions={<Link href="/focus" className={"btn primary" + (focusCount ? "" : " off")}>▶ Démarrer le mode focus{focusCount ? ` (${focusCount})` : ""}</Link>} />
      <DayPlan plan={plan} niches={niches} preview={preview} onStart="/focus" startCount={focusCount} />
      <div style={{ marginTop: 10 }}><AiQueueProgress /></div>
      <div className="card progress-card" style={{ marginTop: 12 }}>
        <Progress label="Nouveaux WhatsApp" n={counts.newWa} goal={goals.newGoal} hard={goals.newHard} />
        <Progress label="Relances" n={counts.relances} goal={goals.relances} />
        <Progress label="Réponses reçues aujourd'hui" n={counts.replies} />
      </div>

      <Block n={1} title="Réponses à traiter" lead="Ils t'ont répondu : à traiter en premier." data={blocks.reponses} onResolved={refresh} nicheOf={nicheOf}
        empty={<Empty title="Aucune réponse en attente">Les prospects qui répondent arrivent ici.</Empty>} />
      <Block n={2} title="Relances du jour" lead="Relances J+2 et J+7 après le premier message." data={blocks.relances} onResolved={refresh} goalLabel="relances" nicheOf={nicheOf}
        empty={<Empty title="Aucune relance due aujourd'hui" />} />
      <Block n={3} title="Nouveaux à contacter" lead="Premier WhatsApp, dans l'ordre choisi dans Réglages." data={blocks.nouveaux} onResolved={refresh} goalLabel="WhatsApp" nicheOf={nicheOf}
        empty={toContact
          ? <Empty title="Aucun prospect ne correspond à cette sélection">Élargis « Ma journée » ci-dessus, ou ajoute des fiches depuis <Link href="/commerces">Commerces</Link> (« Ajouter à ma journée »).</Empty>
          : <Empty title="Plus aucun prospect à contacter" action={<><Link className="btn sm" href="/sources/excel">Importer un fichier</Link><Link className="btn sm" href="/sources">Chercher des prospects</Link></>} />} />

      {toCall > 0 && (
        <Link href="/commerces?vue=appeler" className="card row spread tocall">
          <span>📞 <b>{toCall}</b> fiche{toCall > 1 ? "s" : ""} sans WhatsApp à appeler <span className="muted small">(sans quota)</span></span><span className="muted">→</span>
        </Link>
      )}
      {denueNew > 0 && (
        <Link href="/sources/denue?tab=enregistrees" className="card row spread tocall" style={{ marginTop: 8 }}>
          <span>🆕 <span className="count-badge">{denueNew} nouveau{denueNew > 1 ? "x" : ""}</span> établissement{denueNew > 1 ? "s" : ""} DENUE (veille) à valider</span><span className="muted">→</span>
        </Link>
      )}
    </>
  );
}
