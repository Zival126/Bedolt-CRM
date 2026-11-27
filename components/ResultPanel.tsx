"use client";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { MOTIFS } from "@/lib/constants";
import { type Stage, waUrl } from "@/lib/stage";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import { setPending, clearPending, isTouch } from "./wa-pending";

export type PanelItem = {
  id: number; nom: string; stage: Stage;
  waNumber: string;                         // '' : pas de WhatsApp possible
  waText: string;                           // message proposé (fiche ou modèle des Réglages)
  template: "first" | "j2" | "j7" | null;  // null : conversation déjà engagée
  tel: string;                              // lien tel: ou ''
  waBlocked?: string;                       // raison du blocage (limite dure du jour)
  noWhatsapp?: boolean;
  aiDraft?: boolean;                        // waText = brouillon proposé par l'IA (à relire avant l'envoi)
};
export type PanelHandle = { wa: () => void; repondu: () => void; pasRepondu: () => void; perdu: () => void };
type Mode = "idle" | "wa" | "call" | "motif" | "autre" | "follow-reponse" | "follow-interesse" | "rappel" | "etape";
type Res = { undo: number; message: string; follow: "reponse" | "interesse" | null; statut: string; counts: Record<string, number> };

const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };

/**
 * Boutons de résultat adaptés à l'étape du prospect. Chaque clic enregistre le résultat (toast + Annuler 10 s) ;
 * `onResolved` est appelé quand la fiche est traitée (le mode focus passe alors au suivant).
 */
const ResultPanel = forwardRef<PanelHandle, {
  item: PanelItem; size?: "lg" | "md"; editor?: "always" | "toggle" | "none";
  onResolved?: (r: { statut?: string; counts?: Record<string, number> }) => void;
  /** Appelé après chaque résultat enregistré (avant la question de suite éventuelle) : ex. couleur du point sur la carte. */
  onResult?: (r: { statut: string }) => void;
}>(function ResultPanel({ item, size = "md", editor = "toggle", onResolved, onResult }, ref) {
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(item.waText);
  const [edit, setEdit] = useState(editor === "always");
  const [detail, setDetail] = useState("");
  const [step, setStep] = useState("");
  const [date, setDate] = useState("");
  const [err, setErr] = useState("");
  const waRef = useRef<HTMLAnchorElement>(null);
  const st = item.stage;
  const last = useRef<{ statut?: string; counts?: Record<string, number> }>({});

  async function send(result: string, extra: object = {}): Promise<Res | null> {
    setBusy(true); setErr("");
    try {
      const r = await postJson<Res>("/api/result", { id: item.id, result, ...extra });
      toast(r.message, { undo: r.undo, businessId: item.id });
      last.current = { statut: r.statut, counts: r.counts };
      onResult?.({ statut: r.statut });
      return r;
    } catch (e) { setErr((e as Error).message); toastError(e); return null; }
    finally { setBusy(false); }
  }
  const done = () => { setMode("idle"); onResolved?.(last.current); };
  const run = async (result: string, extra: object = {}) => { const r = await send(result, extra); if (!r) return; if (r.follow === "reponse") setMode("follow-reponse"); else if (r.follow === "interesse") { setStep(""); setDate(""); setMode("follow-interesse"); } else done(); };

  const canWa = !!item.waNumber && !item.waBlocked && st !== "perdu" && st !== "paye";
  const href = canWa ? waUrl(item.waNumber, msg) : undefined;
  function openWa(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!href) { e.preventDefault(); return; }
    setPending({ id: item.id, nom: item.nom, template: item.template, at: Date.now() });
    if (!isTouch()) { e.preventDefault(); window.open(href, "_blank", "noopener"); }
    setMode("wa");
  }
  const allows = { repondu: !["perdu", "paye"].includes(st), pas: ["new", "j2", "j7", "rappel", "etape"].includes(st) };
  useImperativeHandle(ref, () => ({
    wa: () => { if (mode === "idle" && canWa) waRef.current?.click(); },
    repondu: () => { if (mode === "idle" && allows.repondu && !busy) run("repondu", { canal: "whatsapp" }); },
    pasRepondu: () => { if (mode === "idle" && allows.pas && !busy) run("pas_repondu", { canal: "whatsapp" }); },
    perdu: () => { if (mode === "idle" && st !== "perdu" && st !== "paye") setMode("motif"); },
  }));

  const B = ({ children, onClick, kind = "", disabled }: { children: React.ReactNode; onClick: () => void; kind?: string; disabled?: boolean }) =>
    <button type="button" className={`btn ${kind}`} disabled={busy || disabled} onClick={onClick}>{children}</button>;
  const waLabel = st === "new" ? "Envoyer WhatsApp" : st === "j2" ? "Relancer · J+2" : st === "j7" || st === "fin" ? "Relancer · J+7" : "WhatsApp";
  const WaLink = ({ primary }: { primary?: boolean }) => canWa
    ? <a ref={waRef} href={href} onClick={openWa} className={`btn wa${primary ? " big" : ""}`} rel="noopener noreferrer">{waLabel}</a>
    : <span className={`btn wa off${primary ? " big" : ""}`} title={item.waBlocked || "Pas de numéro WhatsApp"}>{item.waBlocked ? "WhatsApp bloqué" : item.noWhatsapp ? "Sans WhatsApp" : "Pas de WhatsApp"}</span>;
  const Call = () => item.tel ? <a className="btn" href={item.tel} onClick={() => setMode("call")}>📞 Appeler</a> : null;
  const Perdu = () => <B kind="lost" onClick={() => setMode("motif")}>Perdu…</B>;

  let body: React.ReactNode;
  if (mode === "wa") body = (
    <div className="ask">
      <b>Envoyé ?</b>
      <div className="grid g3">
        <B kind="primary" onClick={async () => { clearPending(); await run("wa_sent", item.template ? { template: item.template } : {}); }}>Oui, envoyé</B>
        <B onClick={() => { clearPending(); setMode("idle"); }}>Pas envoyé</B>
        <B onClick={() => { clearPending(); run("no_wa", { toCall: true }); }}>Pas de WhatsApp</B>
      </div>
    </div>
  );
  else if (mode === "call") body = (
    <div className="ask"><b>Résultat de l'appel</b>
      <div className="grid g3">
        <B kind="primary" onClick={() => run("repondu", { canal: "appel" })}>A répondu</B>
        <B onClick={() => run("pas_repondu", { canal: "appel" })} disabled={!allows.pas}>Pas répondu</B>
        <B onClick={() => setMode("idle")}>Retour</B>
      </div>
    </div>
  );
  else if (mode === "motif") body = (
    <div className="ask"><b>Motif de la perte</b>
      <div className="grid g2">
        {MOTIFS.map((m) => <B key={m.key} kind="lost" onClick={() => (m.key === "autre" ? setMode("autre") : run("perdu", { motif: m.key }))}>{m.label}</B>)}
        <B onClick={() => setMode("idle")}>Retour</B>
      </div>
    </div>
  );
  else if (mode === "autre") body = (
    <div className="ask"><b>Perdu · autre motif</b>
      <input value={detail} maxLength={500} onChange={(e) => setDetail(e.target.value)} placeholder="Précision (optionnel)" autoFocus />
      <div className="grid g2"><B kind="lost" onClick={() => run("perdu", { motif: "autre", detail })}>Valider</B><B onClick={() => setMode("motif")}>Retour</B></div>
    </div>
  );
  else if (mode === "follow-reponse") body = (
    <div className="ask"><b>Et ensuite ?</b>
      <div className="grid g2">
        <B kind="primary" onClick={() => run("interesse")}>Intéressé</B>
        <B kind="lost" onClick={() => run("perdu", { motif: "pas_interesse" })}>Pas intéressé</B>
        <B onClick={() => { setDate(addDays(1)); setMode("rappel"); }}>À rappeler le…</B>
        <B kind="ghost" onClick={done}>Plus tard</B>
      </div>
    </div>
  );
  else if (mode === "rappel") body = (
    <div className="ask"><b>À rappeler le</b>
      <div className="chips">{[["Demain", 1], ["Dans 3 j", 3], ["Dans 7 j", 7]].map(([l, n]) => <button type="button" key={l} className={date === addDays(Number(n)) ? "on" : ""} onClick={() => setDate(addDays(Number(n)))}>{l}</button>)}</div>
      <input type="date" value={date} min={addDays(0)} onChange={(e) => setDate(e.target.value)} />
      <div className="grid g2"><B kind="primary" disabled={!date} onClick={() => run("rappel", { date })}>Enregistrer</B><B onClick={() => setMode(st === "reponse" || st === "rappel" ? "idle" : "follow-reponse")}>Retour</B></div>
    </div>
  );
  else if (mode === "follow-interesse" || mode === "etape") body = (
    <div className="ask"><b>{mode === "etape" ? "Nouvelle étape" : "Intéressé 🎯 · prochaine étape ?"}</b>
      <input value={step} maxLength={500} onChange={(e) => setStep(e.target.value)} placeholder="Ex. envoyer la maquette, visio…" autoFocus />
      <div className="chips">{[["Demain", 1], ["Dans 3 j", 3], ["Dans 7 j", 7]].map(([l, n]) => <button type="button" key={l} className={date === addDays(Number(n)) ? "on" : ""} onClick={() => setDate(addDays(Number(n)))}>{l}</button>)}</div>
      <input type="date" value={date} min={addDays(0)} onChange={(e) => setDate(e.target.value)} aria-label="Date de la prochaine étape" />
      <div className="grid g2">
        <B kind="primary" disabled={!step.trim() && !date} onClick={async () => { const r = await send("etape", { next_step: step, date }); if (r) done(); }}>Enregistrer</B>
        <B kind="ghost" onClick={() => (mode === "etape" ? setMode("idle") : done())}>{mode === "etape" ? "Retour" : "Passer"}</B>
      </div>
    </div>
  );
  else body = (
    <>
      {(st === "new" || st === "j2" || st === "j7") && <WaLink primary />}
      {st === "fin" && <B kind="lost big" onClick={() => run("perdu", { motif: "pas_de_reponse" })}>Perdu · pas de réponse</B>}
      {(st === "reponse" || st === "rappel") && <B kind="primary big" onClick={() => run("interesse")}>Intéressé</B>}
      {st === "etape" && <B kind="ok big" onClick={() => run("paye")}>Payé 🎉</B>}
      {st === "perdu" && <B kind="primary big" onClick={() => run("reactiver")}>Réactiver la fiche</B>}
      <div className="acts">
        {st === "new" && <><B onClick={() => run("no_wa", { toCall: true })} disabled={!item.waNumber}>Pas de WhatsApp</B><B onClick={() => run("repondu", { canal: "whatsapp" })}>A répondu</B><Call /><Perdu /></>}
        {(st === "j2" || st === "j7") && <><B kind="primary-soft" onClick={() => run("repondu", { canal: "whatsapp" })}>A répondu</B><B onClick={() => run("pas_repondu", { canal: "whatsapp" })}>Pas répondu</B><Call />
          {st === "j7" ? <B kind="lost" onClick={() => run("perdu", { motif: "pas_de_reponse" })}>Perdu · sans réponse</B> : <Perdu />}</>}
        {st === "fin" && <><B kind="primary-soft" onClick={() => run("repondu", { canal: "whatsapp" })}>A répondu</B><B onClick={() => run("reporter")}>Reporter 7 j</B><WaLink /><Call /></>}
        {(st === "reponse" || st === "rappel") && <><B kind="lost" onClick={() => run("perdu", { motif: "pas_interesse" })}>Pas intéressé</B>
          <B onClick={() => { setDate(addDays(1)); setMode("rappel"); }}>À rappeler le…</B><WaLink /><Call />{st === "rappel" && <B onClick={() => run("pas_repondu", { canal: "appel" })}>Pas répondu</B>}</>}
        {st === "etape" && <><B onClick={() => { setStep(""); setDate(""); setMode("etape"); }}>Nouvelle étape</B><WaLink /><Call /><Perdu /></>}
      </div>
      {item.waBlocked && st === "new" && <p className="small warn-text">{item.waBlocked}</p>}
    </>
  );
  const showEditor = canWa && mode === "idle" && editor !== "none" && ["new", "j2", "j7", "fin", "reponse", "rappel", "etape"].includes(st);
  return (
    <div className={`panel ${size}`} aria-busy={busy}>
      {showEditor && editor === "toggle" && !edit && <button type="button" className="link small" onClick={() => setEdit(true)}>✎ {msg ? "Voir / modifier le message" : "Écrire un message"}{item.aiDraft && <span className="badge ai" style={{ marginLeft: 6 }} title="Brouillon proposé par l'IA">IA</span>}</button>}
      {showEditor && edit && (
        <label className="f"><span>Message WhatsApp {item.template === "first" ? "" : item.template ? "(relance)" : ""}{item.aiDraft && <><span className="badge ai" style={{ marginLeft: 6 }}>IA</span> <span className="tiny muted">brouillon de l'IA : relis et modifie avant d'envoyer</span></>}</span>
          <textarea value={msg} maxLength={4000} rows={size === "lg" ? 6 : 4} onChange={(e) => setMsg(e.target.value)} placeholder="Message vide : WhatsApp s'ouvre sans texte (modèles dans Réglages)." />
        </label>
      )}
      {body}
      {err && <p className="small err" role="alert">{err}</p>}
    </div>
  );
});
export default ResultPanel;
