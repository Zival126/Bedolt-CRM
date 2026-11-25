"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getJson, postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import { saveTextSettings } from "@/app/actions";
import { COLUMNS, DEFAULT_COLUMNS, type ColumnKey } from "@/lib/columns";

const Saved = ({ on }: { on: boolean }) => (on ? <span className="saved" role="status">Enregistré ✓</span> : null);

/** Réglages > Messages : modèles WhatsApp avec aperçu ({nom} remplacé par un exemple). */
export function MessagesForm({ initial }: { initial: { key: string; label: string; setting: string; value: string; hint: string }[] }) {
  const [v, setV] = useState(Object.fromEntries(initial.map((t) => [t.setting, t.value])));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sample, setSample] = useState("Salón Bella");
  async function save() {
    setBusy(true); setSaved(false);
    const fd = new FormData();
    for (const [k, x] of Object.entries(v)) fd.set(k, x);
    const r = await saveTextSettings(fd);
    setBusy(false);
    if (r?.error) toast(r.error, { kind: "err" }); else setSaved(true);
  }
  return (
    <div className="card stack">
      <label className="f" style={{ maxWidth: 280 }}>Nom d'exemple pour l'aperçu<input value={sample} onChange={(e) => setSample(e.target.value)} maxLength={60} /></label>
      {initial.map((t) => (
        <div key={t.setting} className="grid" style={{ gap: 8 }}>
          <label className="f"><span><b style={{ color: "var(--text)" }}>{t.label}</b> · {t.hint}</span>
            <textarea value={v[t.setting]} onChange={(e) => { setV({ ...v, [t.setting]: e.target.value }); setSaved(false); }} placeholder="Écris ton message ici… ex. ¡Hola {nom}! 👋" /></label>
          {v[t.setting]?.trim() ? <div className="wa-preview" aria-label={`Aperçu ${t.label}`}>{v[t.setting].replaceAll("{nom}", sample || "{nom}")}</div>
            : <span className="tiny muted">Vide : WhatsApp s'ouvrira sans texte.</span>}
        </div>
      ))}
      <div className="row"><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "…" : "Enregistrer les messages"}</button><Saved on={saved} /></div>
    </div>
  );
}

/** Réglages > IA : critères de classement et prompt système. */
export function IaTexts({ criteria, system }: { criteria: string; system: string }) {
  const [c, setC] = useState(criteria), [s, setS] = useState(system);
  const [saved, setSaved] = useState(false);
  async function save() {
    const fd = new FormData(); fd.set("ia_criteria", c); fd.set("ia_system_prompt", s);
    const r = await saveTextSettings(fd);
    if (r?.error) toast(r.error, { kind: "err" }); else setSaved(true);
  }
  return (
    <div className="card stack">
      <label className="f">Critères de classement (bouton « Classer avec l'IA » de Commerces)<textarea value={c} onChange={(e) => { setC(e.target.value); setSaved(false); }} /></label>
      <label className="f">Prompt système du chat<textarea value={s} onChange={(e) => { setS(e.target.value); setSaved(false); }} style={{ minHeight: 140 }} /></label>
      <div className="row"><button type="button" className="btn primary" onClick={save}>Enregistrer</button><Saved on={saved} /></div>
    </div>
  );
}

/** Réglages > Sources & clés : serveurs OpenStreetMap (Overpass), dans l'ordre d'essai. */
export function OsmInstances() {
  const [d, setD] = useState<{ instances: string[]; defaults: string[]; env: boolean } | null>(null);
  const [list, setList] = useState<string[]>([]);
  const [add, setAdd] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { getJson<{ instances: string[]; defaults: string[]; env: boolean }>("/api/settings/osm").then((r) => { setD(r); setList(r.instances); }).catch(toastError); }, []);
  async function save(next: string[] | null) {
    try {
      const r = await postJson<{ instances: string[]; defaults: string[]; env: boolean }>("/api/settings/osm", next ? { instances: next } : { reset: true });
      setD(r); setList(r.instances); setSaved(true);
    } catch (e) { toastError(e); }
  }
  if (!d) return <div className="skel" style={{ height: 120 }} />;
  const move = (i: number, k: number) => { const j = i + k; if (j < 0 || j >= list.length) return; const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; setList(n); setSaved(false); };
  return (
    <div className="card stack">
      <div className="row spread"><b>Serveurs OpenStreetMap (Overpass)</b><button type="button" className="btn sm ghost" onClick={() => save(null)}>Liste par défaut</button></div>
      <p className="small muted" style={{ margin: 0 }}>Essayés dans cet ordre : si l'un est saturé, le suivant prend le relais automatiquement.{d.env ? " OVERPASS_URL (.env) est toujours essayé en premier." : ""}</p>
      {list.map((u, i) => (
        <div key={u} className="row spread" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
          <span className="small" style={{ minWidth: 0, overflowWrap: "anywhere" }}><b>{i + 1}.</b> {u}</span>
          <span className="row" style={{ gap: 2, flexWrap: "nowrap" }}>
            <button type="button" className="btn sm ghost" aria-label="Monter" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="btn sm ghost" aria-label="Descendre" disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="btn sm ghost danger" aria-label="Retirer" disabled={list.length <= 1} onClick={() => { setList(list.filter((x) => x !== u)); setSaved(false); }}>×</button>
          </span>
        </div>
      ))}
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="https://…/api/interpreter" aria-label="Ajouter un serveur Overpass" />
        <button type="button" className="btn" disabled={!/^https:\/\/[a-z0-9.-]+\//i.test(add.trim())} onClick={() => { setList([...list, add.trim()]); setAdd(""); setSaved(false); }}>Ajouter</button>
      </div>
      <div className="row"><button type="button" className="btn primary" onClick={() => save(list)}>Enregistrer l'ordre</button><Saved on={saved} /></div>
    </div>
  );
}

/** Réglages > Affichage : colonnes par défaut de Commerces, couleur de la carte. */
export function DisplaySettings({ columns, mapColor }: { columns: ColumnKey[]; mapColor: "niche" | "statut" }) {
  const router = useRouter();
  const [cols, setCols] = useState(columns);
  const [mc, setMc] = useState(mapColor);
  const [saved, setSaved] = useState("");
  async function saveCols(next: ColumnKey[] | null) {
    try { const r = await postJson<{ columns: ColumnKey[] }>("/api/settings/columns", next ? { columns: next } : { reset: true }); setCols(r.columns); setSaved("cols"); router.refresh(); } catch (e) { toastError(e); }
  }
  async function saveMap(m: "niche" | "statut") {
    try {
      await postJson("/api/settings/display", { mapColor: m }); setMc(m); setSaved("map");
      try { localStorage.removeItem("bedolt-carte-couleur"); } catch { /* */ }
    } catch (e) { toastError(e); }
  }
  return (
    <div className="stack">
      <div className="card stack">
        <b>Carte : couleur des points</b>
        <div className="seg" role="group" aria-label="Couleur des points de la carte">
          <button type="button" className={mc === "niche" ? "on" : ""} aria-pressed={mc === "niche"} onClick={() => saveMap("niche")}>Par niche (contour = statut)</button>
          <button type="button" className={mc === "statut" ? "on" : ""} aria-pressed={mc === "statut"} onClick={() => saveMap("statut")}>Par statut</button>
        </div>
        <Saved on={saved === "map"} />
      </div>
      <div className="card stack">
        <div className="row spread"><b>Colonnes du tableau Commerces (ordinateur)</b><button type="button" className="btn sm ghost" onClick={() => saveCols(null)}>Par défaut</button></div>
        <div className="colpick">
          {COLUMNS.map((c) => (
            <div key={c.key} className={"colrow" + (cols.includes(c.key) ? " on" : "")}>
              <label className="chk small"><input type="checkbox" checked={cols.includes(c.key)} disabled={c.key === "nom"}
                onChange={() => saveCols(cols.includes(c.key) ? cols.filter((x) => x !== c.key) : [...cols, c.key])} />{c.label}</label>
            </div>
          ))}
        </div>
        <span className="tiny muted">{cols.join() === DEFAULT_COLUMNS.join() ? "Colonnes par défaut. " : ""}L'ordre se règle depuis Commerces (⋯ → Colonnes du tableau).</span>
        <Saved on={saved === "cols"} />
      </div>
    </div>
  );
}

type ApiS = { key: string; label: string; enabled: boolean; env: string; used: number; cap: number; storage: "id" | "full"; free: string; storageNote: string; keyHelp: string; termHelp: string; attribution: string; googleRich?: boolean };
/** Réglages > Sources & clés : sources API (état de la clé, compteur du mois, plafond, stockage, test). */
export function ApiSourcesSettings() {
  const [list, setList] = useState<ApiS[] | null>(null);
  const [caps, setCaps] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  useEffect(() => { getJson<{ providers: ApiS[] }>("/api/settings/api-sources").then((r) => { setList(r.providers); setCaps(Object.fromEntries(r.providers.map((p) => [p.key, String(p.cap)]))); }).catch(toastError); }, []);
  async function save(key: string, body: object, text = "Enregistré ✓") {
    try { const r = await postJson<{ providers: ApiS[] }>("/api/settings/api-sources", { action: "save", provider: key, ...body }); setList(r.providers); setMsg({ ...msg, [key]: { ok: true, text } }); }
    catch (e) { toastError(e); }
  }
  async function test(key: string) {
    setMsg({ ...msg, [key]: { ok: true, text: "Test… (1 appel)" } });
    try { const r = await postJson<{ ok: boolean; message: string; providers: ApiS[] }>("/api/settings/api-sources", { action: "test", provider: key }); setList(r.providers); setMsg({ ...msg, [key]: { ok: r.ok, text: r.message } }); }
    catch (e) { setMsg({ ...msg, [key]: { ok: false, text: (e as Error).message } }); }
  }
  if (!list) return <div className="skel" style={{ height: 160 }} />;
  return (
    <div className="stack">
      {list.map((p) => (
        <div key={p.key} className="card stack" style={{ gap: 8 }}>
          <div className="row spread"><b>{p.label}</b>{p.enabled ? <span className="state ok">Clé présente</span> : <span className="state off">Clé requise</span>}</div>
          {p.enabled ? <>
            <div className="row" style={{ gap: 8 }}>
              <span className="small"><b>{p.used.toLocaleString("fr-FR")}</b> / {p.cap.toLocaleString("fr-FR")} appels ce mois-ci</span>
              <div className="bar" style={{ flex: "1 1 120px", marginTop: 0 }}><i style={{ width: Math.min(100, (p.used / Math.max(1, p.cap)) * 100) + "%" }} /></div>
            </div>
            <div className="row">
              <label className="f" style={{ flex: "1 1 140px", maxWidth: 220 }}>Plafond mensuel (appels)<input type="number" min={0} step={100} value={caps[p.key] ?? ""} onChange={(e) => setCaps({ ...caps, [p.key]: e.target.value })} /></label>
              <button type="button" className="btn" style={{ alignSelf: "flex-end" }} onClick={() => save(p.key, { cap: Number(caps[p.key]) || 0 })}>Enregistrer</button>
              <button type="button" className="btn ghost" style={{ alignSelf: "flex-end" }} onClick={() => test(p.key)}>Tester (1 appel)</button>
            </div>
            <label className="f">Stockage des résultats
              <select value={p.storage} onChange={(e) => (e.target.value === "id" || confirm("Mode complet : à n'utiliser que si ton contrat avec ce fournisseur autorise le stockage des données. Continuer ?")) && save(p.key, { storage: e.target.value })}>
                <option value="id">Identifiant + nom seulement (conforme aux conditions standard)</option>
                <option value="full">Complet : téléphone, site, adresse, catégorie → spécialité (contrat qui l'autorise)</option>
              </select></label>
            {p.key === "google" && <label className="chk small"><input type="checkbox" checked={!!p.googleRich} onChange={(e) => save(p.key, { googleRich: e.target.checked })} />Demander téléphone et site (SKU « Enterprise » : 1 000 gratuits / mois, au lieu de 5 000)</label>}
          </> : <p className="small muted" style={{ margin: 0 }}>Désactivée : aucune requête. {p.keyHelp} ; ajoute <code>{p.env}=…</code> dans <code>.env</code> puis redémarre.</p>}
          <details className="tiny muted"><summary>Offre gratuite et conditions</summary><p style={{ margin: "6px 0" }}>{p.free}</p><p style={{ margin: 0 }}>{p.storageNote}</p></details>
          {msg[p.key] && <span className={msg[p.key].ok ? "saved" : "small err"} role="status">{msg[p.key].text}</span>}
        </div>
      ))}
    </div>
  );
}
