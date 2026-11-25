"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import { NicheIcon, NicheBadge, fmtN } from "./ui";
import { NICHE_ICONS } from "@/lib/niche-style";
import type { Main, PlanRow } from "@/lib/niche-regroup";

type Last = { id: number; at: string; summary: Record<string, number>; backup: string; canUndo: boolean; why: string } | null;
type Plan = { mains: Main[]; rows: PlanRow[]; summary: { auto: number; unsure: number; none: number; fiches: number }; last: Last };
type Res = Plan & { result?: { merged: number; moved: number; noNiche: number; created: number; mains: number; backup: string }; undone?: { restored: number } };
type Show = "move" | "unsure" | "none" | "main" | "all";
const SURE = 70;
const STEP = 120;

// Regrouper les niches : niches principales (modifiables), proposition pour chaque niche, application, annulation.
export default function RegroupView({ initial, defaults }: { initial: Plan; defaults: (Main & { desc: string })[] }) {
  const router = useRouter();
  const [mains, setMains] = useState<Main[]>(initial.mains);
  const [plan, setPlan] = useState(initial);
  const [assign, setAssign] = useState<Record<number, string>>(() => Object.fromEntries(initial.rows.map((r) => [r.id, r.target])));
  const [dirtyMains, setDirtyMains] = useState(false);
  const [show, setShow] = useState<Show>(initial.summary.unsure ? "unsure" : "move");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState("");
  const [limit, setLimit] = useState(STEP);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Res["result"] | null>(null);
  const [newMain, setNewMain] = useState("");

  const label = (k: string) => (k === "none" ? "Sans niche" : k === "keep" ? "Garder telle quelle" : mains.find((m) => m.key === k)?.label ?? k);
  const isMove = (r: PlanRow) => !(r.main && assign[r.id] === r.target);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return plan.rows.filter((r) => {
      if (t && !r.label.toLowerCase().includes(t)) return false;
      const a = assign[r.id];
      if (show === "move") return isMove(r) && a !== "keep";
      // Filtres sur la PROPOSITION (une ligne corrigée reste visible)
      if (show === "unsure") return !r.main && r.target !== "none" && r.confidence < SURE;
      if (show === "none") return !r.main && r.target === "none";
      if (show === "main") return !isMove(r) || a === "keep";
      return true;
    });
  }, [plan, assign, show, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    let move = 0, fiches = 0, none = 0, noneF = 0, keep = 0;
    for (const r of plan.rows) {
      const a = assign[r.id];
      if (a === "keep" || !isMove(r)) { keep++; continue; }
      move++; fiches += r.fiches;
      if (a === "none") { none++; noneF += r.fiches; }
    }
    return { move, fiches, none, noneF, keep };
  }, [plan, assign]); // eslint-disable-line react-hooks/exhaustive-deps
  const perMain = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of plan.rows) { const a = assign[r.id]; if (a !== "none" && a !== "keep") m.set(a, (m.get(a) ?? 0) + r.fiches); }
    return m;
  }, [plan, assign]);

  async function recompute(next = mains) {
    setBusy(true);
    try {
      const r = await postJson<Plan>("/api/niches/regroup", { action: "plan", mains: next });
      setPlan(r); setAssign(Object.fromEntries(r.rows.map((x) => [x.id, x.target]))); setDirtyMains(false); setSel(new Set());
    } catch (e) { toastError(e); }
    setBusy(false);
  }
  async function apply() {
    if (!counts.move) return toast("Rien à regrouper.");
    if (!confirm(`Regrouper ${fmtN(counts.move)} niche(s) (${fmtN(counts.fiches)} fiches) dans ${mains.length} niches principales ?\n${counts.none ? `${counts.none} niche(s) deviendront « Sans niche » (spécialité conservée).\n` : ""}La base est sauvegardée juste avant, et « Annuler le dernier regroupement » reste possible.`)) return;
    setBusy(true);
    try {
      const r = await postJson<Res>("/api/niches/regroup", { action: "apply", mains, assign: Object.fromEntries(Object.entries(assign).map(([k, v]) => [k, v])) });
      setDone(r.result ?? null); setPlan(r); setAssign(Object.fromEntries(r.rows.map((x) => [x.id, x.target]))); setSel(new Set());
      toast("Regroupement appliqué ✓"); router.refresh();
    } catch (e) { toastError(e); }
    setBusy(false);
  }
  async function undo() {
    if (!confirm("Annuler le dernier regroupement ? Les niches, leurs correspondances et la niche / spécialité de chaque fiche reviennent à l'état d'avant.")) return;
    setBusy(true);
    try {
      const r = await postJson<Res>("/api/niches/regroup", { action: "undo" });
      setDone(null); setPlan(r); setAssign(Object.fromEntries(r.rows.map((x) => [x.id, x.target])));
      toast(`Regroupement annulé : ${fmtN(r.undone?.restored ?? 0)} fiche(s) remise(s) dans leur niche d'origine.`); router.refresh();
    } catch (e) { toastError(e); }
    setBusy(false);
  }
  const setMain = (i: number, p: Partial<Main>) => { setMains(mains.map((m, j) => (j === i ? { ...m, ...p } : m))); setDirtyMains(true); };
  const targets = [...mains.map((m) => [m.key, m.label]), ["none", "Sans niche (spécialité conservée)"], ["keep", "Garder telle quelle"]] as [string, string][];
  const last = plan.last;

  return (
    <div className="stack" style={{ gap: 18 }}>
      {last && (
        <div className={"banner" + (last.canUndo ? "" : " ")} style={{ fontWeight: 500 }}>
          <div className="row spread">
            <span>Dernier regroupement le {new Date(last.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} : {fmtN(last.summary.merged ?? 0)} niche(s) fusionnée(s), {fmtN(last.summary.moved ?? 0)} fiche(s) déplacée(s){last.summary.noNiche ? `, ${fmtN(last.summary.noNiche)} sans niche` : ""}.{last.backup ? ` Sauvegarde : ${last.backup}.` : ""}</span>
            {last.canUndo ? <button type="button" className="btn sm" disabled={busy} onClick={undo}>Annuler le dernier regroupement</button>
              : <span className="tiny muted">Annulation impossible : {last.why}.</span>}
          </div>
        </div>
      )}
      {done && <div className="banner ok">✓ {fmtN(done.merged)} niche(s) fusionnée(s), {fmtN(done.moved)} fiche(s) déplacée(s), {fmtN(done.noNiche)} sans niche. <Link href="/stats#niches">Voir les stats par niche →</Link></div>}

      <section className="card stack" aria-labelledby="mains-t">
        <div className="row spread"><p id="mains-t" className="step-t"><span className="step-n">1</span>Niches principales</p>
          {dirtyMains && <button type="button" className="btn sm primary" disabled={busy} onClick={() => recompute()}>Recalculer la proposition</button>}</div>
        <p className="small muted" style={{ margin: 0 }}>Renomme, retire ou ajoute des niches avant de valider. Une niche existante du même nom (ou la plus grosse qui y va) est gardée avec sa couleur ; sinon la niche est créée.</p>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
          {mains.map((m, i) => (
            <div key={m.key} className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
              <span className="niche-ico" style={{ "--n": "#a5b4fc", width: 36, height: 36 } as React.CSSProperties}><NicheIcon icon={m.icon} size={18} /></span>
              <input value={m.label} maxLength={60} onChange={(e) => setMain(i, { label: e.target.value })} aria-label={`Nom de la niche principale ${i + 1}`} title={defaults.find((d) => d.key === m.key)?.desc} />
              <span className="tiny muted nowrap" title="fiches proposées">{fmtN(perMain.get(m.key) ?? 0)}</span>
              <button type="button" className="btn sm ghost" aria-label={`Retirer ${m.label}`} onClick={() => { const next = mains.filter((_, j) => j !== i); setMains(next); recompute(next); }}>×</button>
            </div>
          ))}
        </div>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input value={newMain} onChange={(e) => setNewMain(e.target.value)} maxLength={60} placeholder="Ajouter une niche principale (ex. Hôtels)" aria-label="Nouvelle niche principale" />
          <button type="button" className="btn" disabled={!newMain.trim()} onClick={() => { const next = [...mains, { key: "c" + Date.now().toString(36), label: newMain.trim(), icon: "tag" }]; setMains(next); setNewMain(""); recompute(next); }}>Ajouter</button>
          {mains.length !== defaults.length && <button type="button" className="btn ghost" onClick={() => { const d = defaults.map(({ key, label, icon }) => ({ key, label, icon })); setMains(d); recompute(d); }}>Liste par défaut</button>}
        </div>
        <details className="tiny muted"><summary>Icônes disponibles</summary><span>{Object.values(NICHE_ICONS).map(([l]) => l).join(", ")}</span></details>
      </section>

      <section className="stack" aria-labelledby="plan-t" style={{ gap: 10 }}>
        <p id="plan-t" className="step-t"><span className="step-n">2</span>Vérifier la proposition</p>
        <div className="row" style={{ gap: 6 }}>
          <span className="badge ok">{fmtN(plan.summary.auto)} classées automatiquement</span>
          <span className="badge warn">{fmtN(plan.summary.unsure)} incertaines</span>
          <span className="badge">{fmtN(plan.summary.none)} sans correspondance</span>
          <span className="small muted">sur {fmtN(plan.rows.filter((r) => !r.main).length)} niches à regrouper</span>
        </div>
        <nav className="tabs" style={{ margin: 0 }} aria-label="Filtrer">
          {([["unsure", "Incertaines"], ["none", "Sans correspondance"], ["move", "Toutes à regrouper"], ["main", "Gardées"], ["all", "Toutes"]] as [Show, string][]).map(([k, l]) =>
            <button key={k} type="button" className={show === k ? "on" : ""} aria-pressed={show === k} onClick={() => { setShow(k); setLimit(STEP); setSel(new Set()); }}>{l}</button>)}
        </nav>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(STEP); }} placeholder="Chercher une niche…" aria-label="Chercher une niche" />
        </div>
        <div className="row">
          <label className="chk small"><input type="checkbox" checked={rows.length > 0 && rows.slice(0, limit).every((r) => sel.has(r.id))}
            onChange={(e) => setSel(e.target.checked ? new Set(rows.slice(0, limit).map((r) => r.id)) : new Set())} />Tout cocher ({fmtN(Math.min(limit, rows.length))})</label>
          {sel.size > 0 && <>
            <select value={bulk} onChange={(e) => setBulk(e.target.value)} aria-label="Cible pour la sélection" style={{ width: "auto", minWidth: 200 }}>
              <option value="">Envoyer les {sel.size} cochées vers…</option>{targets.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <button type="button" className="btn sm" disabled={!bulk} onClick={() => { setAssign({ ...assign, ...Object.fromEntries([...sel].map((id) => [id, bulk])) }); setSel(new Set()); setBulk(""); }}>Appliquer à la sélection</button>
          </>}
        </div>
        <div className="list">
          {rows.slice(0, limit).map((r) => {
            const a = assign[r.id];
            const changed = a !== r.target;
            return (
              <div key={r.id} className="card regroup-row" style={{ padding: 10 }}>
                <input type="checkbox" checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} aria-label={`Sélectionner ${r.label}`} />
                <div style={{ minWidth: 0 }}>
                  <NicheBadge n={{ id: r.id, label: r.label, color: r.color, icon: r.icon }} small count={r.fiches} />
                  <div className="tiny muted" style={{ marginTop: 2 }}>{r.main && a === r.target ? "niche principale (gardée)" : r.reason}</div>
                </div>
                <div className="regroup-target">
                  <span aria-hidden="true" className="muted">→</span>
                  <select value={a} onChange={(e) => setAssign({ ...assign, [r.id]: e.target.value })} aria-label={`Niche cible pour ${r.label}`}>
                    {targets.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  {a === "none" || a === "keep" ? <span className="badge">{label(a) === "Sans niche" ? "sans niche" : "gardée"}</span>
                    : <span className={"badge " + (changed ? "accent" : r.confidence >= SURE ? "ok" : "warn")} title="confiance du classement">{changed ? "choix manuel" : `${r.confidence} %`}</span>}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <div className="empty">Aucune niche dans ce filtre.</div>}
        </div>
        {rows.length > limit && <button type="button" className="btn wide" onClick={() => setLimit(limit + STEP)}>Afficher plus ({fmtN(rows.length - limit)} restantes)</button>}
      </section>

      <div className="actionbar" role="region" aria-label="Appliquer">
        <span className="grow"><b>{fmtN(counts.move)}</b> niche(s) à regrouper · {fmtN(counts.fiches)} fiche(s){counts.none ? ` · ${counts.none} → sans niche (${fmtN(counts.noneF)} fiches)` : ""} · {mains.length} niches principales</span>
        <button type="button" className="btn primary" disabled={busy || dirtyMains || !counts.move} onClick={apply}>{busy ? "…" : "Appliquer le regroupement"}</button>
      </div>
      {dirtyMains && <p className="small warn-text" style={{ margin: 0 }}>Niches principales modifiées : clique « Recalculer la proposition » avant d'appliquer.</p>}
    </div>
  );
}
