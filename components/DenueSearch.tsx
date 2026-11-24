"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { postJson } from "./client-api";
import { toast, toastError } from "./Toast";
import ActivityPicker from "./denue/ActivityPicker";
import Results from "./denue/Results";
import Market from "./denue/Market";
import { describe, STRATES, type Code, type NicheP, type Params, type Row, type Saved } from "./denue/types";
import ZonePicker, { type ZoneVal } from "./ZonePicker";
import type { TileConfig } from "@/lib/tiles";

const DenueMap = dynamic(() => import("./denue/DenueMap"), { ssr: false, loading: () => <div className="denue-map-wrap"><div className="denue-map" /></div> });

type Mode = Params["mode"];
type Prog = { step: string; done: number; total: number; fetched: number };
export type DenueInit = { tab?: string; mode?: Mode; lat?: number; lng?: number; codes?: string[]; entidad?: string; municipio?: string; estrato?: string; saved?: number; news?: boolean; zone?: ZoneVal };
const LAST_ZONE = "bedolt-denue-zone";

export default function DenueSearch({ entidades, favoris, defaultZone, niches, saved: savedInit, tiles, init, titles }: {
  entidades: { code: string; nom: string }[]; favoris: ZoneVal[]; defaultZone: ZoneVal; niches: NicheP[]; saved: Saved[]; tiles: TileConfig; init: DenueInit; titles: Record<string, string>;
}) {
  const [tab, setTab] = useState<"recherche" | "enregistrees" | "marche">(init.tab === "marche" ? "marche" : init.tab === "enregistrees" ? "enregistrees" : "recherche");
  const [mode, setMode] = useState<Mode>(init.mode ?? "zone");
  const [codes, setCodes] = useState<Code[]>((init.codes ?? []).map((c) => ({ code: c, title: titles[c] ?? "" })));
  const [f, setF] = useState({ estrato: init.estrato ?? "", nombre: "", q: "", method: "nombre" as "nombre" | "entidad", condition: "", rayon: 1000 });
  // Zone : URL, sinon la dernière utilisée (navigateur), sinon la valeur par défaut
  const [zone, setZoneState] = useState<ZoneVal>(init.zone ?? defaultZone);
  const [nomEnt, setNomEnt] = useState<ZoneVal>({ ent: (init.zone ?? defaultZone).ent, mun: "", loc: "", label: entidades.find((e) => e.code === (init.zone ?? defaultZone).ent)?.nom ?? "" });
  const [pointZone, setPointZone] = useState<ZoneVal>({ ent: "", mun: "", loc: "", label: "" });
  useEffect(() => {
    if (init.zone) return;
    try { const z = JSON.parse(localStorage.getItem(LAST_ZONE) ?? "null") as ZoneVal | null; if (z && /^\d{2}$/.test(z.ent)) { setZoneState(z); setNomEnt({ ent: z.ent, mun: "", loc: "", label: entidades.find((e) => e.code === z.ent)?.nom ?? "" }); } } catch { /* stockage indisponible */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setZone = (z: ZoneVal) => { setZoneState(z); setCount(null); try { localStorage.setItem(LAST_ZONE, JSON.stringify(z)); } catch { /* */ } };
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(init.lat != null && init.lng != null ? { lat: init.lat, lng: init.lng } : null);
  const [rows, setRows] = useState<Row[]>([]);
  const [prog, setProg] = useState<Prog | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "" | "warn" | "bad"; text: string } | null>(null);
  const [count, setCount] = useState<{ total: number; pages: number; by: { code: string; title: string; total: number }[] } | null>(null);
  const [last, setLast] = useState<{ params: Params; label: string; savedId?: number; news?: boolean } | null>(null);
  const [saved, setSaved] = useState<Saved[]>(savedInit);
  const [selected, setSelected] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const codeTitle = (c: string) => codes.find((x) => x.code === c)?.title || titles[c] || "";
  const newsTotal = saved.reduce((a, s) => a + s.news, 0);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF((x) => ({ ...x, [k]: k === "rayon" ? Number(e.target.value) : e.target.value })); setCount(null); };

  function params(): Params | null {
    const c = codes.map((x) => x.code);
    if (mode === "zone") {
      if (!c.length) { setMsg({ kind: "warn", text: "Choisis au moins une activité (recherche ou « Mes niches »)." }); return null; }
      if (!zone.ent || zone.ent === "00") { setMsg({ kind: "warn", text: "Choisis un État (puis, si tu veux, un municipio ou une ville)." }); return null; }
      return { mode, entidad: zone.ent, municipio: zone.mun, localidad: zone.mun ? zone.loc : "", codes: c, estrato: f.estrato, nombre: f.nombre.trim(), place: zone.label };
    }
    if (mode === "point") {
      if (!point) { setMsg({ kind: "warn", text: "Choisis le point : touche la carte, « Ma position » ou saisis les coordonnées." }); return null; }
      return { mode, lat: point.lat, lng: point.lng, rayon: Math.min(5000, Math.max(1, f.rayon || 1000)), condition: f.condition.trim(), codes: c, place: pointZone.label };
    }
    if (f.q.trim().length < 2) { setMsg({ kind: "warn", text: "Saisis au moins 2 caractères." }); return null; }
    if (nomEnt.ent === "00" && !confirm("Recherche dans tout le Mexique : le volume peut être très important (plusieurs milliers de résultats, pages de 500). Continuer ?")) return null;
    return { mode, q: f.q.trim(), method: f.method, entidad: nomEnt.ent || "23", codes: c, place: nomEnt.ent === "00" ? "tout le Mexique" : nomEnt.label };
  }

  async function doCount() {
    const p = params();
    if (!p || p.mode !== "zone") return;
    setBusy(true); setMsg(null);
    try { setCount(await postJson("/api/denue/count", { codes: p.codes, entidad: p.entidad, municipio: p.municipio, localidad: p.localidad, estrato: p.estrato })); }
    catch (e) { setMsg({ kind: "bad", text: (e as Error).message }); }
    setBusy(false);
  }

  async function run(p: Params, label = describe(p, codeTitle), savedId?: number) {
    abort.current?.abort();
    const ac = new AbortController(); abort.current = ac;
    setBusy(true); setMsg(null); setProg({ step: "Connexion à DENUE…", done: 0, total: 1, fetched: 0 }); setSelected(null);
    setLast({ params: p, label, savedId });
    try {
      const res = await fetch("/api/denue/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ params: p }), signal: ac.signal });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? `Erreur ${res.status}`); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "progress") setProg(ev);
          else if (ev.type === "error") throw new Error(ev.error);
          else if (ev.type === "done") {
            setRows(ev.rows);
            if (ev.partial) setMsg({ kind: "warn", text: `Recherche interrompue après ${ev.rows.length} résultat(s) : ${ev.partial} — « Reprendre » relance sans redemander les pages déjà lues (cache 24 h).` });
            else if (!ev.rows.length) setMsg({ kind: "", text: "Aucun établissement ne correspond." });
            else setMsg({ kind: "", text: `${ev.rows.length.toLocaleString("fr-FR")} établissement(s)${ev.expected != null && ev.expected !== ev.rows.length ? ` (comptage DENUE : ${ev.expected.toLocaleString("fr-FR")})` : ""} · ${ev.requests} requête(s).` });
          }
        }
      }
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg({ kind: "bad", text: (e as Error).message });
    }
    setProg(null); setBusy(false);
  }

  function gps() {
    if (!navigator.geolocation) return toast("Géolocalisation indisponible.", { kind: "err" });
    navigator.geolocation.getCurrentPosition((p) => { setPoint({ lat: p.coords.latitude, lng: p.coords.longitude }); setMode("point"); },
      () => toast("Position refusée : autorise la localisation pour ce site.", { kind: "err" }), { enableHighAccuracy: true, timeout: 15_000 });
  }

  async function saveSearch() {
    if (!last) return;
    const name = prompt("Nom de la recherche :", last.label.slice(0, 80))?.trim();
    if (!name) return;
    const watch = confirm("Relancer automatiquement chaque semaine (veille) ?\nSeuls les établissements jamais vus seront signalés, jamais ajoutés sans toi.");
    try {
      const r = await postJson<{ id: number; searches: Saved[] }>("/api/denue/saved", { action: "save", name: name.slice(0, 100), params: last.params, watch, seen: rows.map((x) => x.clee) });
      setSaved(r.searches); setLast({ ...last, savedId: r.id }); toast(`Recherche « ${name} » enregistrée${watch ? " · veille hebdomadaire activée" : ""}.`);
    } catch (e) { toastError(e); }
  }
  async function savedAction(body: object) {
    try { const r = await postJson<{ searches: Saved[] }>("/api/denue/saved", body); setSaved(r.searches); return r; } catch (e) { toastError(e); return null; }
  }
  function load(s: Saved, go = true) {
    const p = s.params;
    setMode(p.mode); setTab("recherche"); setCount(null);
    setCodes(p.codes.map((c) => ({ code: c, title: titles[c] ?? "" })));
    if (p.mode === "zone") { setF((x) => ({ ...x, estrato: p.estrato, nombre: p.nombre })); setZoneState({ ent: p.entidad, mun: p.municipio, loc: p.localidad, label: p.place || describe(p, () => "").split(" · ")[1] || "" }); }
    if (p.mode === "point") { setPoint({ lat: p.lat, lng: p.lng }); setF((x) => ({ ...x, rayon: p.rayon, condition: p.condition })); setPointZone({ ent: "", mun: "", loc: "", label: p.place ?? "" }); }
    if (p.mode === "nom") { setF((x) => ({ ...x, q: p.q, method: p.method })); setNomEnt({ ent: p.entidad, mun: "", loc: "", label: p.place ?? "" }); }
    if (go) run(p, s.name, s.id);
  }
  async function showNews(s: Saved) {
    const r = await postJson<{ rows: Row[] }>("/api/denue/saved", { action: "news", id: s.id }).catch((e) => { toastError(e); return null; });
    if (!r) return;
    load(s, false);
    setRows(r.rows); setLast({ params: s.params, label: s.name, savedId: s.id, news: true });
    setMsg({ kind: "", text: `${r.rows.length} nouvel(s) établissement(s) depuis la dernière veille de « ${s.name} ». Ajoute ceux qui t'intéressent, puis « Marquer comme vus ».` });
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  useEffect(() => {
    if (init.saved) { const s = savedInit.find((x) => x.id === init.saved); if (s) { if (init.news) showNews(s); else load(s); } }
    else if (init.codes?.length && init.zone && init.mode !== "point") run({ mode: "zone", entidad: init.zone.ent, municipio: init.zone.mun, localidad: init.zone.loc, codes: init.codes, estrato: init.estrato ?? "", nombre: "", place: init.zone.label });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = prog ? Math.round((prog.done / Math.max(1, prog.total)) * 100) : 0;
  const submit = (e: React.FormEvent) => { e.preventDefault(); const p = params(); if (p) run(p); };

  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "recherche"} className={tab === "recherche" ? "on" : ""} onClick={() => setTab("recherche")}>Recherche</button>
        <button role="tab" aria-selected={tab === "enregistrees"} className={tab === "enregistrees" ? "on" : ""} onClick={() => setTab("enregistrees")}>
          Enregistrées{newsTotal ? <span className="count-badge">{newsTotal} nouveau{newsTotal > 1 ? "x" : ""}</span> : saved.length ? ` (${saved.length})` : ""}</button>
        <button role="tab" aria-selected={tab === "marche"} className={tab === "marche" ? "on" : ""} onClick={() => setTab("marche")}>Marché</button>
      </div>

      {tab === "marche" && <Market entidades={entidades} onOpen={(c, z, e) => {
        setMode("zone"); setTab("recherche"); setCodes(c.map((x) => ({ code: x, title: titles[x] ?? "" }))); setF((x) => ({ ...x, estrato: e, nombre: "" })); setZone(z);
        run({ mode: "zone", entidad: z.ent, municipio: z.mun, localidad: "", codes: c, estrato: e, nombre: "", place: z.label });
      }} />}

      {tab === "enregistrees" && (
        <section className="stack" style={{ gap: 8 }}>
          {saved.length === 0 && <div className="empty">Aucune recherche enregistrée. Lance une recherche puis « Enregistrer la recherche ».</div>}
          {saved.map((s) => (
            <div key={s.id} className="card stack saved-search" style={{ padding: 12, gap: 6 }}>
              <div className="row spread" style={{ alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}><b>{s.name}</b><div className="small muted">{describe(s.params, (c) => titles[c] ?? "")}</div></div>
                {s.news > 0 && <button type="button" className="count-badge big" onClick={() => showNews(s)}>{s.news} nouveau{s.news > 1 ? "x" : ""}</button>}
              </div>
              <div className="tiny muted">{s.last_run_at ? `Dernière exécution : ${new Date(s.last_run_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}${s.last_total != null ? ` · ${s.last_total} établissement(s)` : ""}` : "Jamais exécutée par la veille"}
                {s.last_error ? <span className="warn-text"> · {s.last_error}</span> : null}</div>
              <div className="row">
                <button type="button" className="btn sm primary" disabled={busy} onClick={() => load(s)}>Relancer</button>
                {s.news > 0 && <button type="button" className="btn sm" onClick={() => showNews(s)}>Voir les nouveaux</button>}
                {s.news > 0 && <button type="button" className="btn sm ghost" onClick={() => savedAction({ action: "dismiss", id: s.id })}>Marquer comme vus</button>}
                <label className="chk small"><input type="checkbox" checked={s.watch} onChange={(e) => savedAction({ action: "watch", id: s.id, watch: e.target.checked })} />Relancer chaque semaine</label>
                <button type="button" className="btn sm ghost danger" onClick={() => confirm(`Supprimer « ${s.name} » ?`) && savedAction({ action: "delete", id: s.id })}>Supprimer</button>
              </div>
            </div>
          ))}
          {saved.some((s) => s.watch) && <p className="tiny muted">Veille : le serveur vérifie toutes les heures et relance chaque recherche cochée tous les 7 jours. Il ne fait que signaler les établissements jamais vus (CLEE) : aucun ajout automatique.</p>}
        </section>
      )}

      {tab === "recherche" && (
        <>
          <div className="tabs sub">
            {([["zone", "Zone + activité"], ["point", "Autour d'un point"], ["nom", "Nom / mot-clé"]] as const).map(([k, l]) => (
              <button key={k} type="button" className={mode === k ? "on" : ""} onClick={() => { setMode(k); setCount(null); setMsg(null); }}>{l}</button>
            ))}
          </div>
          <form className="card stack" onSubmit={submit} style={{ gap: 12 }}>
            <ActivityPicker value={codes} onChange={(c) => { setCodes(c); setCount(null); }} niches={niches} required={mode === "zone"} />
            {mode === "zone" && <ZonePicker value={zone} onChange={setZone} entidades={entidades} favoris={favoris} />}
            {mode === "zone" && (
              <div className="grid gform">
                <label className="f">Taille (strate)<select value={f.estrato} onChange={set("estrato")}>{STRATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <label className="f">Nom contient (facultatif)<input value={f.nombre} onChange={set("nombre")} maxLength={100} placeholder="ex. nails" /></label>
              </div>
            )}
            {mode === "point" && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="grid g2">
                  <label className="f">Latitude<input value={point?.lat ?? ""} inputMode="decimal" onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setPoint({ lat: v, lng: point?.lng ?? -86.85 }); }} /></label>
                  <label className="f">Longitude<input value={point?.lng ?? ""} inputMode="decimal" onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setPoint({ lat: point?.lat ?? 21.16, lng: v }); }} /></label>
                </div>
                <div className="grid gform">
                  <label className="f">Rayon : {f.rayon.toLocaleString("fr-FR")} m (max 5 000)<input type="range" min={100} max={5000} step={100} value={f.rayon} onChange={set("rayon")} /></label>
                  <label className="f">Mot-clé (facultatif)<input value={f.condition} onChange={set("condition")} maxLength={100} placeholder="tous (ex. uñas, spa)" /></label>
                </div>
                <ZonePicker value={pointZone} label="Centrer sur une ville (n'importe où au Mexique)" entidades={entidades} favoris={favoris}
                  onChange={(z) => { setPointZone(z); if (z.lat != null && z.lng != null) setPoint({ lat: z.lat, lng: z.lng }); else toast("Pas de point connu pour cette zone : choisis une ville, ou touche la carte.", { kind: "err" }); }} />
                <div className="row"><button type="button" className="btn sm" onClick={gps}>◎ Ma position</button><span className="tiny muted">ou touche la carte ci-dessous · depuis une fiche : « Chercher autour (DENUE) »</span></div>
              </div>
            )}
            {mode === "nom" && (
              <div className="grid gform">
                <div className="full"><ZonePicker value={nomEnt} onChange={setNomEnt} entidades={entidades} favoris={favoris} level="state" allowCountry label="État (ou tout le Mexique)" /></div>
                {nomEnt.ent === "00" && <p className="full small warn-text" style={{ margin: 0 }}>Tout le Mexique : volume potentiellement très important (une page = 500 établissements). Préfère un État si possible.</p>}
                <label className="f full">Nom ou mot-clé<input value={f.q} onChange={set("q")} maxLength={100} placeholder="ex. barbería, nails, spa" /></label>
                <label className="f">Méthode<select value={f.method} onChange={set("method")}>
                  <option value="nombre">Nom ou raison sociale (Nombre)</option><option value="entidad">Mot-clé partout : nom, rue, colonia, activité (BuscarEntidad)</option></select></label>
              </div>
            )}
            {count && mode === "zone" && (
              <div className="banner">
                <b>{count.total.toLocaleString("fr-FR")} établissement(s)</b> · ~{count.pages} page(s) de 500 · {count.by.map((b) => `${b.code} : ${b.total.toLocaleString("fr-FR")}`).join(" · ")}
              </div>
            )}
            <div className="row">
              <button className="btn primary" disabled={busy}>{busy ? "Recherche…" : "Rechercher"}</button>
              {mode === "zone" && <button type="button" className="btn" disabled={busy} onClick={doCount}>Compter d'abord</button>}
              {busy && <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>Arrêter</button>}
              {last && !busy && !last.news && <button type="button" className="btn ghost" onClick={saveSearch}>{last.savedId ? "Enregistrer sous…" : "Enregistrer la recherche"}</button>}
              {last && !busy && msg?.kind === "warn" && msg.text.includes("Reprendre") && <button type="button" className="btn" onClick={() => run(last.params, last.label, last.savedId)}>Reprendre</button>}
            </div>
            {prog && (
              <div className="stack" style={{ gap: 4 }} aria-live="polite">
                <div className="row spread small"><span>{prog.step}</span><b>{prog.fetched.toLocaleString("fr-FR")} reçus</b></div>
                <div className="bar"><i style={{ width: pct + "%" }} /></div>
              </div>
            )}
            {msg && <p className={"small " + (msg.kind === "bad" ? "err" : msg.kind === "warn" ? "warn-text" : "muted")} style={{ margin: 0 }} role="status">{msg.text}</p>}
          </form>

          <div className="row spread" style={{ margin: "12px 0 6px" }}>
            <b className="small muted">Carte{rows.length ? ` · ${rows.filter((r) => r.lat != null).length.toLocaleString("fr-FR")} positionné(s)` : ""}</b>
            <button type="button" className="btn sm ghost" onClick={() => setShowMap((v) => !v)}>{showMap ? "Masquer la carte" : "Afficher la carte"}</button>
          </div>
          {(showMap || mode === "point") && <DenueMap tiles={tiles} rows={rows} point={mode === "point" ? point : null} rayon={f.rayon} picking={mode === "point"}
            onPick={(p) => setPoint({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 })}
            onSelect={(c) => { setSelected(c); document.getElementById("r-" + c)?.scrollIntoView({ block: "nearest" }); }} selected={selected} />}

          <div ref={resultsRef} />
          {rows.length > 0 && last && (
            <Results key={last.label + rows.length} rows={rows} setRows={setRows} label={last.label} selected={selected} onSelect={setSelected}
              header={last.news && last.savedId ? (
                <div className="banner row spread"><span>Nouveaux de la veille « {last.label} »</span>
                  <button type="button" className="btn sm" onClick={async () => { await savedAction({ action: "dismiss", id: last.savedId }); setRows([]); setLast(null); setMsg({ kind: "", text: "Marqués comme vus." }); }}>Marquer comme vus</button></div>
              ) : undefined} />
          )}
        </>
      )}
    </>
  );
}
