"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "./client-api";
import { toast } from "./Toast";
import NicheChips from "./NicheChips";
import type { NicheLite } from "@/lib/niche-style";
import type { QueueFilter } from "@/lib/settings";

type Obj = { newGoal: number; newHard: number; relances: number; order: "offre_avis" | "avis" | "recent"; filter: QueueFilter };
type Opts = { niches: NicheLite[]; zones: string[]; offres: string[]; villes: string[]; sources: string[] };
const SRC: Record<string, string> = { excel: "Excel / Gemini", denue: "DENUE", osm: "OpenStreetMap", overture: "Overture", manuel: "Manuel", google: "Google" };
const FICHES = [["oui", "Oui"], ["non", "Non"], ["vide", "Vide"], ["verifier", "À vérifier"], ["", "Non renseignée"]] as const;
const ORDERS = [["offre_avis", "Offre (P1→P3) puis nb d'avis"], ["avis", "Nb d'avis seul"], ["recent", "Date d'ajout"]] as const;

function Multi({ label, values, sel, onChange, noneLabel }: { label: string; values: string[]; sel: string[]; onChange: (v: string[]) => void; noneLabel?: string }) {
  const all = noneLabel ? [...values, ""] : values;
  const toggle = (v: string) => onChange(sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row spread"><span className="small muted">{label}</span>
        <span className="small">{sel.length ? <button type="button" className="link" onClick={() => onChange([])}>{sel.length} choisi{sel.length > 1 ? "s" : ""} · tout effacer</button> : <span className="muted">tous</span>}</span></div>
      {all.length === 0 ? <span className="small muted">Aucune valeur dans la base.</span> : (
        <div className="ms">{all.map((v) => <button type="button" key={v || "__none"} className={sel.includes(v) ? "on" : ""} aria-pressed={sel.includes(v)} onClick={() => toggle(v)}>{v || noneLabel}</button>)}</div>
      )}
    </div>
  );
}

export default function ObjectivesForm({ initial, options, matching: m0, risk }: { initial: Obj; options: Opts; matching: number; risk: number }) {
  const router = useRouter();
  const [o, setO] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [matching, setMatching] = useState(m0);
  const f = o.filter;
  const setF = (patch: Partial<Obj["filter"]>) => setO({ ...o, filter: { ...f, ...patch } });
  const int = (v: string) => (v === "" ? 0 : Math.max(0, Math.floor(Number(v)) || 0));
  async function save() {
    setBusy(true); setMsg({});
    try {
      const r = await postJson<{ matching: number }>("/api/settings/objectives", o);
      setMatching(r.matching); setMsg({ ok: "Enregistré" }); toast("Réglages de prospection enregistrés ✓ — la file du jour est mise à jour.");
      router.refresh();
    } catch (e) { setMsg({ error: (e as Error).message }); }
    setBusy(false);
  }
  const over = o.newGoal > risk;
  const bad = o.newGoal > o.newHard;
  return (
    <div className="card stack">
      <div className="grid g3">
        <label className="f">Nouveaux WhatsApp / jour<input type="number" inputMode="numeric" min={0} max={200} value={o.newGoal} onChange={(e) => setO({ ...o, newGoal: int(e.target.value) })} /></label>
        <label className="f">Limite dure (blocage)<input type="number" inputMode="numeric" min={1} max={200} value={o.newHard} onChange={(e) => setO({ ...o, newHard: Math.max(1, int(e.target.value)) })} /></label>
        <label className="f">Relances / jour<input type="number" inputMode="numeric" min={0} max={500} value={o.relances} onChange={(e) => setO({ ...o, relances: int(e.target.value) })} /></label>
      </div>
      {bad && <p className="small err" role="alert">L'objectif ({o.newGoal}) ne peut pas dépasser la limite dure ({o.newHard}).</p>}
      {over && <div className="banner warn small">⚠️ Plus de {risk} nouveaux WhatsApp par jour : risque de blocage du numéro par WhatsApp (messages à des contacts qui ne t'ont pas enregistré). Monte progressivement.</div>}
      {!over && o.newHard > risk && <p className="small warn-text" style={{ margin: 0 }}>Limite dure au-delà de {risk} : n'y va que ponctuellement (risque de blocage WhatsApp).</p>}
      <p className="small muted" style={{ margin: 0 }}>La limite dure est appliquée par le serveur : au-delà, l'ouverture et l'enregistrement d'un premier WhatsApp sont refusés pour la journée. Les relances et les appels n'ont pas de limite dure.</p>

      <h3 style={{ marginTop: 8 }}>Filtre par défaut de la file « Nouveaux à contacter »</h3>
      <p className="small muted" style={{ margin: 0 }}>Utilisé chaque jour, sauf si tu choisis une autre sélection dans « Ma journée » (page Aujourd'hui).</p>
      <div className="stack" style={{ gap: 6 }}><span className="small muted">Niche(s) — aucune cochée = toutes</span>
        <NicheChips niches={options.niches} value={f.nicheIds} withNone onChange={(nicheIds) => setF({ nicheIds })} scroll={false} /></div>
      <Multi label="Zone(s)" values={options.zones} sel={f.zones} onChange={(zones) => setF({ zones })} noneLabel="Non renseignée" />
      <Multi label="Offre(s)" values={options.offres} sel={f.offres} onChange={(offres) => setF({ offres })} noneLabel="Sans offre" />
      <Multi label="Ville(s)" values={options.villes} sel={f.villes} onChange={(villes) => setF({ villes })} />
      <Multi label="Fiche Google" values={FICHES.filter(([k]) => k).map(([, l]) => l)} sel={f.fiches.map((k) => FICHES.find(([x]) => x === k)![1])}
        onChange={(labels) => setF({ fiches: labels.map((l) => FICHES.find(([, x]) => x === l)![0]) })} />
      {options.sources.length > 1 && <Multi label="Source(s)" values={options.sources.filter((x) => x in SRC).map((x) => SRC[x])} sel={f.sources.map((x) => SRC[x])}
        onChange={(labels) => setF({ sources: labels.map((l) => Object.keys(SRC).find((k) => SRC[k] === l)!) as QueueFilter["sources"] })} />}
      <div className="ms">
        <button type="button" className={f.wa ? "on" : ""} aria-pressed={f.wa} onClick={() => setF({ wa: !f.wa })}>WhatsApp confirmé seulement</button>
        <button type="button" className={f.email ? "on" : ""} aria-pressed={f.email} onClick={() => setF({ email: !f.email })}>Avec email seulement</button>
      </div>
      <label className="f" style={{ maxWidth: 220 }}>Nb d'avis minimum<input type="number" inputMode="numeric" min={0} value={f.avisMin ?? ""} placeholder="aucun" onChange={(e) => setF({ avisMin: e.target.value === "" ? null : int(e.target.value) })} /></label>
      <div className="stack" style={{ gap: 6 }}><span className="small muted">Ordre</span>
        <div className="ms">{ORDERS.map(([k, l]) => <button type="button" key={k} className={o.order === k ? "on" : ""} aria-pressed={o.order === k} onClick={() => setO({ ...o, order: k })}>{l}</button>)}</div></div>
      <p className="small" style={{ margin: 0 }}><b>{matching.toLocaleString("fr-FR")}</b> <span className="muted">prospect(s) « À contacter » avec WhatsApp correspondent au filtre enregistré.</span></p>
      <div className="row"><button className="btn primary" disabled={busy || bad} onClick={save}>{busy ? "…" : "Enregistrer"}</button>
        {msg.ok && <span className="saved" role="status">Enregistré ✓</span>}</div>
      {msg.error && <p className="small err" role="alert">⚠️ {msg.error}</p>}
    </div>
  );
}
