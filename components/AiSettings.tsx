"use client";
import { useEffect, useState } from "react";
import { getJson, postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import { loadAiStatus, useAiStatus } from "./ai-status";
import AiQueueProgress, { queueChanged } from "./AiQueueProgress";

type Params = { analyse: { temperature: number; maxTokens: number }; message: { temperature: number; maxTokens: number }; contextTokens: number; streamIdleS: number; noThink: boolean };
type S = {
  provider: "ollama" | "openai" | "n8n"; ollama_url: string; ollama_model: string; openai_url: string; openai_model: string; openai_key_set: boolean; openai_key_masked: string;
  n8n_url: string; ia_mode: "tools" | "context"; ia_params: Params; ia_style: string; ia_night: { enabled: boolean; time: string };
};
const Dot = ({ on }: { on: boolean | null }) => <span className={"dot" + (on ? " on" : "")} style={on === null ? { background: "var(--muted)" } : undefined} />;

/** Réglages › IA : fournisseur, connexion, modèle, paramètres par tâche, exemples de style. */
export function AiSettings() {
  const [s, setS] = useState<S | null>(null);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<{ ok: boolean | null; message: string }>({ ok: null, message: "" });
  const [busy, setBusy] = useState(false);
  const status = useAiStatus();
  useEffect(() => { getJson<S>("/api/settings/ia").then(setS).catch(toastError); }, []);
  if (!s) return <div className="skel" style={{ height: 260 }} />;
  const up = <K extends keyof S>(k: K, v: S[K]) => setS({ ...s, [k]: v });
  const P = s.ia_params;
  const setP = (f: (p: Params) => Params) => up("ia_params", f(P));
  const num = (v: string, d: number) => (v.trim() === "" || !Number.isFinite(Number(v)) ? d : Number(v));
  const url = s.provider === "openai" ? s.openai_url : s.provider === "n8n" ? s.n8n_url : s.ollama_url;
  const model = s.provider === "openai" ? s.openai_model : s.ollama_model;
  const setModel = (m: string) => up(s.provider === "openai" ? "openai_model" : "ollama_model", m);

  async function runTest() {
    setTest({ ok: null, message: "Test…" });
    try {
      const j = await postJson<{ ok: boolean; models: string[]; message: string }>("/api/ai/test", { provider: s!.provider, url, ...(s!.provider === "openai" && key ? { key } : {}) });
      setTest(j);
      if (j.ok) { setModels(j.models); if (!model && j.models[0]) setModel(j.models[0]); }
    } catch (e) { setTest({ ok: false, message: (e as Error).message }); }
  }
  async function save() {
    setBusy(true);
    try {
      const r = await postJson<{ settings: S }>("/api/settings/ia", {
        ia_provider: s!.provider, ollama_url: s!.ollama_url, ollama_model: s!.ollama_model, openai_url: s!.openai_url, openai_model: s!.openai_model,
        ...(clearKey ? { openai_key_clear: true } : key ? { openai_key: key } : {}), n8n_url: s!.n8n_url, ia_mode: s!.ia_mode, ia_params: P, ia_style: s!.ia_style,
      });
      setS(r.settings); setKey(""); setClearKey(false);
      toast("Réglages IA enregistrés ✓");
      await loadAiStatus(true);
    } catch (e) { toastError(e); }
    setBusy(false);
  }
  const online = status ? status.online : null;
  return (
    <div className="card stack">
      <div className="row"><Dot on={online} /><b>{online === true ? "IA en ligne" : online === false ? (status?.configured ? "IA hors ligne" : "IA non configurée") : "Vérification…"}</b>
        {status?.online && status.model && <span className="small muted">{status.model}</span>}
        <button type="button" className="btn sm ghost" onClick={() => loadAiStatus(true)}>Revérifier</button></div>
      {status && status.message && <p className={"small " + (status.online ? "muted" : "warn-text")} style={{ margin: 0 }}>{status.message}</p>}

      <label className="f">Fournisseur
        <select value={s.provider} onChange={(e) => { up("provider", e.target.value as S["provider"]); setModels([]); setTest({ ok: null, message: "" }); }}>
          <option value="openai">OpenAI compatible (LM Studio, llama.cpp, Ollama /v1…)</option><option value="ollama">Ollama (API native)</option><option value="n8n">Webhook n8n</option>
        </select></label>

      {s.provider === "openai" && <>
        <label className="f">URL de base<input value={s.openai_url} onChange={(e) => up("openai_url", e.target.value)} placeholder="http://100.x.y.z:1234/v1" autoComplete="off" /></label>
        <label className="f"><span>Clé API (optionnelle){s.openai_key_set ? <span className="muted"> · enregistrée {s.openai_key_masked}</span> : <span className="muted"> · LM Studio : inutile (« lm-studio » par défaut)</span>}</span>
          <input type="password" value={key} onChange={(e) => { setKey(e.target.value); setClearKey(false); }} placeholder={s.openai_key_set ? "Laisser vide pour garder la clé enregistrée" : "Colle la clé ici si ton serveur en demande une"} autoComplete="off" /></label>
        {s.openai_key_set && <label className="chk small"><input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} />Effacer la clé enregistrée</label>}
      </>}
      {s.provider === "ollama" && <label className="f">URL du serveur Ollama<input value={s.ollama_url} onChange={(e) => up("ollama_url", e.target.value)} placeholder="http://100.x.y.z:11434" /></label>}
      {s.provider === "n8n" && <>
        <label className="f">URL du webhook n8n<input value={s.n8n_url} onChange={(e) => up("n8n_url", e.target.value)} placeholder="https://…/webhook/…" /></label>
        <p className="small muted" style={{ margin: 0 }}>Le CRM envoie POST {"{ system, message, history }"} et attend {"{ reply }"} (ou du texte). Pas de streaming ni d'outils : les données utiles sont ajoutées au prompt.</p>
      </>}
      {s.provider !== "n8n" && <>
        <div className="row"><button type="button" className="btn" onClick={runTest} disabled={!url.trim()}>Tester la connexion</button>
          {test.message && <span className={"small " + (test.ok ? "ok" : test.ok === false ? "err" : "muted")}>{test.message}</span>}</div>
        <label className="f">Modèle
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {model && !models.includes(model) && <option>{model}</option>}
            {models.map((m) => <option key={m}>{m}</option>)}
            {!models.length && !model && <option value="">Teste la connexion pour lister les modèles</option>}
          </select></label>
        <label className="f">Accès aux données du CRM (chat)
          <select value={s.ia_mode} onChange={(e) => up("ia_mode", e.target.value as S["ia_mode"])}>
            <option value="tools">Fonctions (tool calling) — repli automatique si le modèle les gère mal</option>
            <option value="context">Contexte injecté (données utiles ajoutées au message)</option>
          </select></label>
      </>}

      <b className="small">Paramètres par tâche</b>
      <div className="ia-grid">
        <label className="f">Analyse · température<input type="number" step="0.1" min={0} max={2} value={P.analyse.temperature} onChange={(e) => setP((p) => ({ ...p, analyse: { ...p.analyse, temperature: num(e.target.value, 0.2) } }))} /></label>
        <label className="f">Analyse · longueur max (tokens)<input type="number" min={32} max={16000} value={P.analyse.maxTokens} onChange={(e) => setP((p) => ({ ...p, analyse: { ...p.analyse, maxTokens: num(e.target.value, 800) } }))} /></label>
        <label className="f">Message · température<input type="number" step="0.1" min={0} max={2} value={P.message.temperature} onChange={(e) => setP((p) => ({ ...p, message: { ...p.message, temperature: num(e.target.value, 0.7) } }))} /></label>
        <label className="f">Message · longueur max (tokens)<input type="number" min={32} max={16000} value={P.message.maxTokens} onChange={(e) => setP((p) => ({ ...p, message: { ...p.message, maxTokens: num(e.target.value, 500) } }))} /></label>
        <label className="f">Contexte max envoyé (tokens estimés)<input type="number" min={1000} max={128000} step={500} value={P.contextTokens} onChange={(e) => setP((p) => ({ ...p, contextTokens: num(e.target.value, 6000) }))} /></label>
        <label className="f">Streaming · inactivité max (s)<input type="number" min={10} max={900} value={P.streamIdleS} onChange={(e) => setP((p) => ({ ...p, streamIdleS: num(e.target.value, 120) }))} /></label>
      </div>
      <label className="chk small"><input type="checkbox" checked={P.noThink} onChange={(e) => setP((p) => ({ ...p, noThink: e.target.checked }))} />Désactiver le raisonnement (ajoute « /no_think », conseillé pour Qwen3 : réponses bien plus rapides)</label>

      <label className="f"><span><b style={{ color: "var(--text)" }}>Exemples de style</b> · colle 2-3 de tes vrais messages WhatsApp (l'IA imite le ton, sans recopier)</span>
        <textarea value={s.ia_style} maxLength={4000} onChange={(e) => up("ia_style", e.target.value)} style={{ minHeight: 120 }}
          placeholder={"¡Hola! Soy Thomas de Bedolt 👋 Vi su negocio en Google Maps…\n---\nBuenas tardes, ¿me permite comentarle algo sobre su ficha de Google?"} /></label>
      <p className="tiny muted" style={{ margin: 0 }}>Le premier message s'appuie aussi sur ton modèle « Premier message » (Réglages › Messages). La clé API reste sur le serveur : elle n'est jamais renvoyée au navigateur.</p>
      <div><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "…" : "Enregistrer"}</button></div>
    </div>
  );
}

/** Réglages › IA : préparation des fiches (file IA, nuit). */
export function AiPrepareCard() {
  const [n, setN] = useState<{ enabled: boolean; time: string } | null>(null);
  const status = useAiStatus();
  useEffect(() => { getJson<{ ia_night: { enabled: boolean; time: string } }>("/api/settings/ia").then((j) => setN(j.ia_night)).catch(toastError); }, []);
  async function saveNight(next: { enabled: boolean; time: string }) {
    setN(next);
    try { await postJson("/api/settings/ia", { ia_night: next }); toast(next.enabled ? `Préparation de nuit activée (${next.time}, heure de Cancún).` : "Préparation de nuit désactivée."); } catch (e) { toastError(e); }
  }
  async function today() {
    try { const r = await postJson<{ added: number; skipped: number }>("/api/ai/queue", { action: "prepare", today: true }); toast(`${r.added} fiche(s) de ta file du jour ajoutée(s) à la file IA${r.skipped ? ` (${r.skipped} déjà préparée(s) < 30 j ou déjà en file)` : ""}.`); queueChanged(); }
    catch (e) { toastError(e); }
  }
  return (
    <div className="card stack">
      <b>Préparation des fiches par l'IA</b>
      <p className="small muted" style={{ margin: 0 }}>Pour chaque fiche : <b>analyse</b> (résumé, points à améliorer, priorité) puis <b>brouillon du premier WhatsApp</b> en espagnol. Une fiche à la fois ; une fiche préparée il y a moins de 30 jours n'est pas refaite (sauf « Régénérer » sur la fiche). Tout reste à valider : « Utiliser ce message » sur la fiche, ou relecture dans Aujourd'hui / le mode focus avant d'envoyer.</p>
      {n && <div className="row">
        <label className="chk small"><input type="checkbox" checked={n.enabled} onChange={(e) => saveNight({ ...n, enabled: e.target.checked })} />Préparer chaque nuit la liste du lendemain à</label>
        <input type="time" value={n.time} onChange={(e) => e.target.value && setN({ ...n, time: e.target.value })} onBlur={() => n && saveNight(n)} style={{ width: 120 }} aria-label="Heure de préparation (Cancún)" />
        <span className="tiny muted">heure de Cancún · nouveaux de ta file (Ma journée ou filtres par défaut), limite = objectif du jour, + fiches ajoutées à la main</span>
      </div>}
      <p className="tiny muted" style={{ margin: 0 }}>Si ton PC est éteint, la file s'arrête proprement et reprend toute seule quand l'IA revient en ligne.</p>
      <div className="row"><button type="button" className="btn" onClick={today} disabled={status?.configured === false}>Préparer maintenant ma file du jour</button></div>
      <AiQueueProgress always />
    </div>
  );
}

type Call = { id: number; at: string; task: string; business_id: number | null; nom: string | null; provider: string; model: string; ms: number; prompt_tokens: number | null; completion_tokens: number | null; error: string };
const TASK: Record<string, string> = { chat: "Chat", analyse: "Analyse", message: "Message", classement: "Classement" };
/** Réglages › IA : journal des 100 derniers appels (sans contenu ni secret). */
export function AiLog() {
  const [calls, setCalls] = useState<Call[] | null>(null);
  const load = () => getJson<{ calls: Call[] }>("/api/ai/log").then((j) => setCalls(j.calls)).catch(toastError);
  useEffect(() => { load(); }, []);
  return (
    <div className="card stack">
      <div className="row spread"><b>Journal des appels IA</b><button type="button" className="btn sm ghost" onClick={load}>Actualiser</button></div>
      {!calls ? <div className="skel" style={{ height: 80 }} /> : !calls.length ? <p className="small muted" style={{ margin: 0 }}>Aucun appel pour l'instant.</p> : (
        <div className="ai-log-wrap"><table className="ai-log">
          <thead><tr><th>Date</th><th>Tâche</th><th>Fiche</th><th>Durée</th><th>Tokens</th><th>Erreur</th></tr></thead>
          <tbody>{calls.map((c) => (
            <tr key={c.id}>
              <td className="nowrap">{new Date(c.at).toLocaleString("fr-FR", { timeZone: "America/Cancun", dateStyle: "short", timeStyle: "medium" })}</td>
              <td>{TASK[c.task] ?? c.task}<div className="tiny muted">{c.model}</div></td>
              <td>{c.business_id ? <a href={`/commerces/${c.business_id}`}>{c.nom ?? "#" + c.business_id}</a> : <span className="muted">—</span>}</td>
              <td className="nowrap">{(c.ms / 1000).toFixed(1)} s</td>
              <td className="nowrap">{c.prompt_tokens != null || c.completion_tokens != null ? `${c.prompt_tokens ?? "?"} → ${c.completion_tokens ?? "?"}` : <span className="muted">—</span>}</td>
              <td className="err">{c.error}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      <p className="tiny muted" style={{ margin: 0 }}>100 derniers appels. Ni le contenu des messages ni la clé API ne sont enregistrés.</p>
    </div>
  );
}
