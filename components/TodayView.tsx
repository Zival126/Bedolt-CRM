"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import ResultPanel from "./ResultPanel";
import { OffreBadge, Stars } from "./Badges";
import type { QueueRow } from "@/lib/rows";

type BlockData = { items: QueueRow[]; extra: QueueRow[]; goal: number | null; done: number; total: number };
type Props = {
  day: string; counts: { newWa: number; relances: number; replies: number; calls: number };
  goals: { newGoal: number; newHard: number; relances: number };
  blocks: { reponses: BlockData; relances: BlockData; nouveaux: BlockData };
  toCall: number; toContact: number; denueNew?: number;
};

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

export function RowCard({ r, onResolved }: { r: QueueRow; onResolved: () => void }) {
  return (
    <article className={`qrow st-${r.stage}`}>
      <div className="qinfo">
        <div className="row spread" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
          <Link href={`/commerces/${r.id}`} className="t">{r.nom}</Link>
          <span className={`stage stage-${r.stage}`}>{r.stageLabel}</span>
        </div>
        <div className="meta">{[r.niche, r.zone, r.ville].filter(Boolean).join(" · ")}</div>
        <div className="row" style={{ gap: 6 }}><OffreBadge o={r.offre} /><Stars note={r.note} avis={r.avis} />{r.info && <span className="small muted">{r.info}</span>}</div>
        {r.angle && <div className="angle line1" title={r.angle}>{r.angle}</div>}
      </div>
      <ResultPanel key={r.id + r.stage} item={r.panel} onResolved={onResolved} />
    </article>
  );
}

function Block({ n, title, data, empty, onResolved, goalLabel }: { n: number; title: string; data: BlockData; empty: React.ReactNode; onResolved: () => void; goalLabel?: string }) {
  const reached = data.goal !== null && data.done >= data.goal && data.goal > 0;
  const [more, setMore] = useState(false);
  const shown = more || reached ? (more ? [...data.items, ...data.extra] : []) : data.items;
  return (
    <section className="block">
      <header className="row spread">
        <h2><span className="num">{n}</span>{title} <span className="count">{data.items.length + data.extra.length}</span></h2>
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
      <div className="list">{shown.map((r) => <RowCard key={r.qid} r={r} onResolved={onResolved} />)}</div>
      {!reached && data.extra.length > 0 && (
        <button className="btn ghost wide" onClick={() => setMore(!more)}>{more ? "Replier" : `+ ${data.extra.length} au-delà de l'objectif`}</button>
      )}
    </section>
  );
}

export default function TodayView({ day, counts, goals, blocks, toCall, toContact, denueNew = 0 }: Props) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const focusCount = blocks.reponses.items.length + blocks.relances.items.length + blocks.nouveaux.items.length;
  return (
    <>
      <div className="row spread head">
        <div><h1>Aujourd'hui</h1><p className="muted small" style={{ margin: 0 }}>{longDay(day)}</p></div>
        <Link href="/focus" className={"btn primary big" + (focusCount ? "" : " off")}>▶ Démarrer le mode focus{focusCount ? ` (${focusCount})` : ""}</Link>
      </div>
      <div className="card progress-card">
        <Progress label="Nouveaux WhatsApp" n={counts.newWa} goal={goals.newGoal} hard={goals.newHard} />
        <Progress label="Relances" n={counts.relances} goal={goals.relances} />
        <Progress label="Réponses reçues aujourd'hui" n={counts.replies} />
      </div>

      <Block n={1} title="Réponses à traiter" data={blocks.reponses} onResolved={refresh}
        empty={<>Aucune réponse en attente. Les prospects qui répondent arrivent ici.</>} />
      <Block n={2} title="Relances du jour" data={blocks.relances} onResolved={refresh} goalLabel="relances"
        empty={<>Aucune relance due aujourd'hui (J+2 et J+7 après le premier message).</>} />
      <Block n={3} title="Nouveaux à contacter" data={blocks.nouveaux} onResolved={refresh} goalLabel="WhatsApp"
        empty={toContact
          ? <>Aucun prospect « À contacter » ne correspond au filtre de la file. <Link href="/reglages#objectifs">Élargir le filtre</Link></>
          : <>Plus aucun prospect à contacter. <Link href="/sources?src=excel">Importer un fichier</Link> ou <Link href="/sources">chercher dans les sources</Link>.</>} />

      {toCall > 0 && (
        <Link href="/commerces?vue=appeler" className="card row spread tocall">
          <span>📞 <b>{toCall}</b> fiche{toCall > 1 ? "s" : ""} sans WhatsApp à appeler <span className="muted small">(sans quota)</span></span><span className="muted">→</span>
        </Link>
      )}
      {denueNew > 0 && (
        <Link href="/sources?src=denue&tab=enregistrees" className="card row spread tocall" style={{ marginTop: 8 }}>
          <span>🆕 <span className="count-badge">{denueNew} nouveau{denueNew > 1 ? "x" : ""}</span> établissement{denueNew > 1 ? "s" : ""} DENUE (veille) à valider</span><span className="muted">→</span>
        </Link>
      )}
    </>
  );
}
