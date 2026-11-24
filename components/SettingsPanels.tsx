"use client";
import { useEffect, useState } from "react";

const post = (url: string, body: object = {}) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const Dot = ({ on }: { on: boolean | null }) => <span className={"dot" + (on ? " on" : "")} style={on === null ? { background: "var(--muted)" } : undefined} />;

export function DenueSettings() {
  const [masked, setMasked] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [state, setState] = useState<{ ok: boolean | null; message: string }>({ ok: null, message: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/settings/denue").then((r) => r.json()).then((j) => setMasked(j.hasToken ? j.masked : "")); }, []);
  async function save() {
    const j = await post("/api/settings/denue", { token });
    setMasked(j.hasToken ? j.masked : ""); setToken(""); setState({ ok: null, message: "Token enregistré ✓ — clique sur « Tester » pour vérifier." });
  }
  async function test() {
    setBusy(true); setState({ ok: null, message: "Test…" });
    setState(await post("/api/denue/test")); setBusy(false);
  }
  return (
    <div className="card stack">
      <div className="row"><Dot on={state.ok ?? (masked ? null : false)} /><b>{state.ok === true ? "Connecté" : state.ok === false ? "Non connecté" : masked ? "Token enregistré (non testé)" : "Aucun token"}</b>
        {masked && <span className="muted small">{masked}</span>}</div>
      <div className="row"><input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Colle le token DENUE ici" style={{ flex: 1 }} />
        <button className="btn" onClick={save} disabled={!token.trim()}>Enregistrer</button>
        <button className="btn primary" onClick={test} disabled={busy}>Tester</button></div>
      {state.message && <p className={"small " + (state.ok ? "ok" : state.ok === false ? "err" : "muted")}>{state.message}</p>}
      <p className="small muted">Le token reste côté serveur et n'est jamais renvoyé au navigateur. Obtiens-le sur inegi.org.mx (API DENUE).</p>
    </div>
  );
}

export function IaSettings() {
  const [s, setS] = useState({ provider: "ollama", ollama_url: "", ollama_model: "", n8n_url: "", ia_mode: "tools" });
  const [models, setModels] = useState<string[]>([]);
  const [state, setState] = useState<{ ok: boolean | null; message: string }>({ ok: null, message: "" });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch("/api/settings/ia").then((r) => r.json()).then((j) => { setS(j); setLoaded(true); });
    fetch("/api/ai/status").then((r) => r.json()).then((j) => setState({ ok: !!j.online, message: j.online ? "" : j.message ?? "" })).catch(() => {});
  }, []);
  async function test() {
    setState({ ok: null, message: "Test…" });
    const j = await post("/api/ai/test", { url: s.ollama_url });
    setState(j);
    if (j.ok) { setModels(j.models); if (!s.ollama_model && j.models[0]) setS((x) => ({ ...x, ollama_model: j.models[0] })); }
  }
  async function save() { await post("/api/settings/ia", { ia_provider: s.provider, ...s }); setState({ ok: null, message: "Enregistré ✓" }); }
  const up = (k: keyof typeof s) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setS({ ...s, [k]: e.target.value });
  if (!loaded) return <div className="card">Chargement…</div>;
  return (
    <div className="card stack">
      <div className="row"><Dot on={state.ok} /><b>{state.ok === true ? "IA connectée" : state.ok === false ? "IA hors ligne" : "Vérification…"}</b></div>
      <label className="f">Fournisseur<select value={s.provider} onChange={up("provider")}><option value="ollama">Ollama</option><option value="n8n">Webhook n8n</option></select></label>
      {s.provider === "ollama" ? <>
        <label className="f">URL du serveur Ollama<input value={s.ollama_url} onChange={up("ollama_url")} placeholder="http://100.x.y.z:11434" /></label>
        <div className="row"><button className="btn" onClick={test}>Tester la connexion</button></div>
        <label className="f">Modèle
          <select value={s.ollama_model} onChange={up("ollama_model")}>
            {s.ollama_model && !models.includes(s.ollama_model) && <option>{s.ollama_model}</option>}
            {models.map((m) => <option key={m}>{m}</option>)}
            {!models.length && !s.ollama_model && <option value="">Teste la connexion pour lister les modèles</option>}
          </select></label>
        <label className="f">Accès aux données du CRM
          <select value={s.ia_mode} onChange={up("ia_mode")}>
            <option value="tools">Fonctions (tool calling Ollama)</option>
            <option value="context">Contexte injecté (si le modèle gère mal les outils)</option>
          </select></label>
      </> : <label className="f">URL du webhook n8n<input value={s.n8n_url} onChange={up("n8n_url")} placeholder="https://…/webhook/…" /></label>}
      {s.provider === "n8n" && <p className="small muted">Le CRM envoie POST {"{ system, message, history }"} et attend {"{ reply }"} (ou du texte). Pas de streaming ni d'outils : les données utiles sont ajoutées au prompt.</p>}
      <div><button className="btn primary" onClick={save}>Enregistrer</button></div>
      {state.message && <p className={"small " + (state.ok ? "ok" : state.ok === false ? "err" : "muted")}>{state.message}</p>}
    </div>
  );
}
