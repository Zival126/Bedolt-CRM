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
