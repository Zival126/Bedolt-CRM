"use client";
import { useState } from "react";

export default function Login() {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErr("");
    const password = new FormData(e.currentTarget).get("password");
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (r.ok) window.location.href = "/";
    else { setErr((await r.json()).error ?? "Erreur"); setBusy(false); }
  }
  return (
    <main className="login">
      <form onSubmit={submit} className="card stack">
        <h1>Bedolt <span className="muted">CRM</span></h1>
        <input name="password" type="password" placeholder="Mot de passe" autoFocus required />
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={busy}>Entrer</button>
      </form>
    </main>
  );
}
