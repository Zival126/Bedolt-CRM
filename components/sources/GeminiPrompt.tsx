"use client";
import { useMemo, useState } from "react";
import ZonePicker, { type ZoneVal } from "../ZonePicker";
import NicheChips from "../NicheChips";
import { toast } from "../Toast";
import { Step } from "../SourceHead";
import { buildGeminiPrompt, GEMINI_URL } from "@/lib/gemini-prompt";
import type { NicheLite } from "@/lib/niche-style";

type N = NicheLite & { keywords: string[] };
const OFFRE_DEFAUT = "P1 si le commerce n'a pas de site web et moins de 50 avis, P2 s'il n'a pas de site mais plus de 50 avis, P3 s'il a déjà un site";

// « Créer mon fichier avec Gemini » : formulaire → prompt modifiable → copier → coller dans Gemini → importer le CSV.
export default function GeminiPrompt({ niches, entidades, favoris, defaultZone, message }: {
  niches: N[]; entidades: { code: string; nom: string }[]; favoris: ZoneVal[]; defaultZone: ZoneVal; message: string;
}) {
  const [zone, setZone] = useState<ZoneVal>(defaultZone);
  const [ids, setIds] = useState<number[]>(niches[0] ? [niches[0].id] : []);
  const [nombre, setNombre] = useState(100);
  const [crit, setCrit] = useState<string[]>(["sans site web en priorité", "note ≥ 4"]);
  const [critLibre, setCritLibre] = useState("");
  const [offre, setOffre] = useState(false);
  const [offreTxt, setOffreTxt] = useState(OFFRE_DEFAUT);
  const [msgOn, setMsgOn] = useState(!!message.trim());
  const [msg, setMsg] = useState(message);
  const [edited, setEdited] = useState<string | null>(null);
  const CRITS = ["sans site web en priorité", "note ≥ 4", "au moins 10 avis", "fiche Google avec peu de photos", "ouverts récemment"];
  const generated = useMemo(() => buildGeminiPrompt({
    zone: zone.label, niches: niches.filter((n) => ids.includes(n.id)).map((n) => ({ label: n.label, keywords: n.keywords })), nombre,
    criteres: [...crit, critLibre.trim()].filter(Boolean).join(", "), offre: offre ? offreTxt : "", message: msgOn ? msg : "",
  }), [zone, ids, niches, nombre, crit, critLibre, offre, offreTxt, msgOn, msg]);
  const text = edited ?? generated;
  async function copy() {
    try { await navigator.clipboard.writeText(text); toast("Prompt copié ✓ — colle-le dans Gemini."); }
    catch { toast("Copie impossible : sélectionne le texte et copie-le à la main.", { kind: "err" }); }
  }
  const touch = () => setEdited(null);
  return (
    <div className="card stack" style={{ gap: 16 }}>
      <div><b style={{ fontSize: 17 }}>Créer mon fichier avec Gemini</b>
        <p className="small muted" style={{ margin: "2px 0 0" }}>Remplis ce formulaire, copie le prompt, colle-le dans Gemini : il te rend un CSV au format exact de l'import (aucune correspondance de colonnes à faire).</p></div>
      <Step n={1} title="Où"><ZonePicker value={zone} onChange={(z) => { setZone(z); touch(); }} entidades={entidades} favoris={favoris} /></Step>
      <Step n={2} title="Quoi" hint="niches à chercher">
        <NicheChips niches={niches} value={ids} onChange={(v) => { setIds(v); touch(); }} clearLabel="Tout décocher" />
        {!ids.length && <span className="small warn-text">Choisis au moins une niche.</span>}
      </Step>
      <Step n={3} title="Critères">
        <label className="f" style={{ maxWidth: 200 }}>Nombre de commerces visé<input type="number" min={10} max={500} step={10} value={nombre} onChange={(e) => { setNombre(Number(e.target.value) || 100); touch(); }} /></label>
        <div className="ms">{CRITS.map((c) => { const on = crit.includes(c); return <button key={c} type="button" className={"sm" + (on ? " on" : "")} aria-pressed={on} onClick={() => { setCrit(on ? crit.filter((x) => x !== c) : [...crit, c]); touch(); }}>{c}</button>; })}</div>
        <input value={critLibre} onChange={(e) => { setCritLibre(e.target.value); touch(); }} placeholder="Autre critère (facultatif), ex. « près de la plage »" aria-label="Autre critère" maxLength={200} />
        <details>
          <summary className="small muted">Options avancées : colonne Offre, message WhatsApp</summary>
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            <label className="chk small"><input type="checkbox" checked={offre} onChange={(e) => { setOffre(e.target.checked); touch(); }} />Demander à Gemini de remplir « Offre » (P1 / P2 / P3)</label>
            {offre && <textarea value={offreTxt} onChange={(e) => { setOffreTxt(e.target.value); touch(); }} aria-label="Règles de la colonne Offre" style={{ minHeight: 60 }} />}
            <label className="chk small"><input type="checkbox" checked={msgOn} onChange={(e) => { setMsgOn(e.target.checked); touch(); }} />Préparer le « Message WhatsApp » de chaque commerce{message ? " (repris de Réglages › Messages)" : ""}</label>
            {msgOn && <textarea value={msg} onChange={(e) => { setMsg(e.target.value); touch(); }} placeholder="¡Hola {nom}! …" aria-label="Modèle de message WhatsApp" style={{ minHeight: 60 }} />}
          </div>
        </details>
      </Step>
      <Step n={4} title="Copier le prompt" hint={edited !== null ? "modifié à la main" : "tu peux le modifier avant de copier"}>
        <textarea className="prompt-box" value={text} onChange={(e) => setEdited(e.target.value)} aria-label="Prompt Gemini" spellCheck={false} />
        <div className="row">
          <button type="button" className="btn primary" disabled={!ids.length} onClick={copy}>Copier le prompt</button>
          <a className="btn" href={GEMINI_URL} target="_blank" rel="noreferrer noopener">Ouvrir Gemini ↗</a>
          {edited !== null && <button type="button" className="btn ghost" onClick={() => setEdited(null)}>Revenir au prompt généré</button>}
        </div>
        <span className="tiny muted">Ensuite : dans Gemini, exporte ou copie le CSV dans un fichier « .csv », puis importe-le ci-dessous. Plusieurs parties ? Importe-les l'une après l'autre (les doublons sont détectés).</span>
      </Step>
    </div>
  );
}
