"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FIELD_LABELS } from "@/lib/import-shared";
import { statutLabel, VILLES_IMPORT } from "@/lib/constants";

type Mapping = Record<string, number>;
type Format = "bedolt" | "standard";
type Parsed = {
  token: string; fileName: string; format: Format; headers: string[]; rowCount: number; mapping: Mapping;
  mappings: Record<Format, Mapping>; unknown: string[]; fields: string[]; fileWarnings: string[];
};
type Count = { v: string; n: number };
type Summary = { total: number; valid: number; duplicates: number; internal: number; errors: number; warnings: number; byNiche: Count[]; byZone: Count[]; byOffre: Count[]; byVille: Count[] };
type Row = {
  line: number; status: "new" | "duplicate" | "internal" | "error"; nom: string; error?: string; warnings: string[];
  dup?: { id: number; nom: string; reason: string }; internalOf?: number;
  ville?: string; niche?: string; zone?: string; offre?: string; telephone?: string; note?: number | null; avis?: number | null; statut?: string; msg?: boolean;
};
type Prev = { summary: Summary; unknown: string[]; page: number; pages: number; count: number; rows: Row[] };
type Result = { batchId: number; added: number; updated: number; ignored: number; errors: number; ms: number };
type Show = "all" | "new" | "duplicate" | "internal" | "error" | "warning";

const STATUS: Record<Row["status"], [string, string]> = { new: ["Nouveau", "ok"], duplicate: ["Doublon", "warn"], internal: ["Doublon interne", "warn"], error: ["Erreur", "bad"] };

async function api<T>(url: string, body: object): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: "Réponse illisible du serveur." }));
  if (!r.ok) throw new Error(j.error ?? "Erreur");
  return j as T;
}

function Dist({ title, items }: { title: string; items: Count[] }) {
  if (!items.length) return null;
  return (
    <div><div className="small muted" style={{ marginBottom: 4 }}>{title}</div>
      <div className="row">{items.slice(0, 15).map((c) => <span key={c.v} className="badge">{c.v} · {c.n}</span>)}
        {items.length > 15 && <span className="small muted">+{items.length - 15} autres</span>}</div></div>
  );
}

export default function ImportWizard() {
  const router = useRouter();
  const [villeSel, setVilleSel] = useState<string>(VILLES_IMPORT[0]);
  const [villeAutre, setVilleAutre] = useState("");
  const defaultVille = villeSel === "autre" ? villeAutre.trim() : villeSel;
  const [p, setP] = useState<Parsed | null>(null);
  const [format, setFormat] = useState<Format>("standard");
  const [map, setMap] = useState<Mapping>({});
  const [showMap, setShowMap] = useState(false);
  const [previewOn, setPreviewOn] = useState(false);
  const [prev, setPrev] = useState<Prev | null>(null);
  const [page, setPage] = useState(1);
  const [show, setShow] = useState<Show>("all");
  const [dup, setDup] = useState<"ignore" | "update">("ignore");
  const [res, setRes] = useState<Result | null>(null);
  const [cancelMsg, setCancelMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<"" | "upload" | "preview" | "import" | "cancel">("");

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("upload"); setMsg(""); setPrev(null); setRes(null); setP(null); setCancelMsg(""); setPage(1); setShow("all");
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await fetch("/api/import/parse", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({ error: "Réponse illisible du serveur." }));
      if (!r.ok) throw new Error(j.error);
      setP(j); setFormat(j.format); setMap(j.mapping);
      setShowMap(j.format !== "bedolt");
      setPreviewOn(j.format === "bedolt"); // format reconnu : aperçu direct, sans clic
    } catch (err) { setMsg("⚠️ " + (err as Error).message); }
    setBusy("");
  }

  useEffect(() => {
    if (!p || !previewOn || res || map.nom === undefined) return;
    let stop = false;
    setBusy("preview");
    const t = setTimeout(() => {
      api<Prev>("/api/import/preview", { token: p.token, mapping: map, format, defaultVille, page, show })
        .then((j) => { if (!stop) { setPrev(j); setMsg(""); } })
        .catch((err) => { if (!stop) setMsg("⚠️ " + err.message); })
        .finally(() => { if (!stop) setBusy(""); });
    }, 250);
    return () => { stop = true; clearTimeout(t); };
  }, [p, previewOn, res, map, format, defaultVille, page, show]);

  async function doImport() {
    if (!p) return;
    setBusy("import"); setMsg("");
    try {
      setRes(await api<Result>("/api/import/commit", { token: p.token, mapping: map, format, defaultVille, onDuplicate: dup }));
      router.refresh();
    } catch (err) { setMsg("⚠️ " + (err as Error).message); }
    setBusy("");
  }
  async function cancelImport() {
    if (!res || !confirm(`Annuler cet import ? Les ${res.added} fiche(s) créée(s) seront supprimées (sauf celles déjà travaillées).`)) return;
    setBusy("cancel");
    try {
      const j = await api<{ deleted: number; kept: number }>("/api/import/cancel", { batchId: res.batchId });
      setCancelMsg(`Import annulé : ${j.deleted} fiche(s) supprimée(s)` + (j.kept ? `, ${j.kept} conservée(s) (déjà travaillées).` : "."));
      router.refresh();
    } catch (err) { setCancelMsg("⚠️ " + (err as Error).message); }
    setBusy("");
  }
  function changeFormat(f: Format) {
    if (!p) return;
    setFormat(f); setMap(p.mappings[f]); setPage(1);
    if (f === "standard") setShowMap(true);
  }

  const s = prev?.summary;
  const importable = s ? s.valid + (dup === "update" ? s.duplicates : 0) : 0;

  return (
    <>
      <div className="card stack">
        <div className="grid g2">
          <label className="f">Ville par défaut (si le lien Maps ne l'indique pas)
            <select value={villeSel} onChange={(e) => setVilleSel(e.target.value)}>
              {VILLES_IMPORT.map((v) => <option key={v}>{v}</option>)}<option value="autre">Autre…</option>
            </select></label>
          {villeSel === "autre" && <label className="f">Autre ville<input value={villeAutre} maxLength={100} onChange={(e) => setVilleAutre(e.target.value)} placeholder="ex. Bacalar" /></label>}
        </div>
        <div className="row">
          <label className={"btn primary" + (busy === "upload" ? " off" : "")} style={{ cursor: "pointer" }}>{busy === "upload" ? "Lecture du fichier…" : "Choisir un fichier .xlsx / .csv"}
            <input type="file" accept=".xlsx,.csv" onChange={upload} hidden disabled={!!busy} /></label>
          <a className="btn" href="/api/import/template">Modèle « prospects Bedolt »</a>
          <a className="btn sm" href="/api/import/template?format=standard">Ancien modèle</a>
        </div>
        <p className="small muted">Format prospects Bedolt (reconnu automatiquement) : Entreprise | Téléphone | Statut | Niche | Offre | Présence web | Angle | Notes (= zone) | Note Google | Avis | Lien Google Maps | Message WhatsApp. 5 Mo et 5 000 lignes maximum.</p>
      </div>
      {msg && <p className="err">{msg}</p>}

      {p && !res && (
        <>
          <h2>{p.fileName} — {p.rowCount.toLocaleString("fr-FR")} ligne(s)</h2>
          <div className="card stack">
            {format === "bedolt"
              ? <div className="banner ok">✓ Format prospects Bedolt reconnu (« Notes » = zone).</div>
              : <p className="small muted">Format non reconnu : vérifie la correspondance des colonnes.</p>}
            {p.fileWarnings.map((w) => <p key={w} className="small" style={{ color: "var(--warn)" }}>{w}</p>)}
            {(prev?.unknown ?? p.unknown).length > 0 && <p className="small muted">Colonnes ignorées : {(prev?.unknown ?? p.unknown).join(", ")}</p>}
            <div className="row">
              <label className="f" style={{ maxWidth: 320 }}>Format
                <select value={format} onChange={(e) => changeFormat(e.target.value as Format)}>
                  <option value="bedolt">Format prospects Bedolt</option><option value="standard">Ancien format / correspondance libre</option>
                </select></label>
              <button className="btn sm" onClick={() => setShowMap(!showMap)}>{showMap ? "Masquer" : "Modifier"} la correspondance</button>
            </div>
            {showMap && (
              <div className="grid gform">
                {p.fields.map((f) => (
                  <label key={f} className="f">{FIELD_LABELS[f] ?? f}{f === "nom" ? " *" : ""}
                    <select value={map[f] ?? ""} onChange={(e) => { const m = { ...map }; if (e.target.value === "") delete m[f]; else m[f] = Number(e.target.value); setMap(m); setPage(1); }}>
                      <option value="">— ignorer —</option>
                      {p.headers.map((h, i) => <option key={i} value={i}>{h || `(colonne ${i + 1})`}</option>)}
                    </select></label>
                ))}
              </div>
            )}
            {!previewOn && <div><button className="btn primary" disabled={!!busy || map.nom === undefined} onClick={() => setPreviewOn(true)}>Aperçu avant import</button></div>}
            {map.nom === undefined && <span className="err small">Associe la colonne du nom (Entreprise).</span>}
          </div>
        </>
      )}

      {p && s && prev && !res && (
        <>
          <h2>Aperçu {busy === "preview" && <span className="small muted">· mise à jour…</span>}</h2>
          <div className="card stack">
            <div className="row">
              <span className="badge">{s.total} lignes</span><span className="badge ok">{s.valid} nouvelles</span>
              <span className="badge warn">{s.duplicates} doublons (déjà dans le CRM)</span><span className="badge warn">{s.internal} doublons internes</span>
              <span className="badge bad">{s.errors} erreurs</span>{s.warnings > 0 && <span className="badge">{s.warnings} avertissement(s)</span>}
            </div>
            <Dist title="Par niche" items={s.byNiche} /><Dist title="Par zone" items={s.byZone} />
            <Dist title="Par offre" items={s.byOffre} /><Dist title="Par ville" items={s.byVille} />

            <div className="tabs" style={{ flexWrap: "wrap", margin: 0 }}>
              {([["all", "Toutes", s.total], ["new", "Nouvelles", s.valid], ["duplicate", "Doublons", s.duplicates], ["internal", "Doublons internes", s.internal], ["error", "Erreurs", s.errors], ["warning", "Avertissements", s.warnings]] as [Show, string, number][]).map(([k, l, n]) =>
                <button key={k} className={show === k ? "on" : ""} onClick={() => { setShow(k); setPage(1); }}>{l} ({n})</button>)}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="compact">
                <thead><tr><th>Ligne</th><th>État</th><th>Entreprise</th><th>Ville</th><th>Niche</th><th>Zone</th><th>Offre</th><th>★</th><th>Détail</th></tr></thead>
                <tbody>{prev.rows.map((r) => (
                  <tr key={r.line}>
                    <td>L{r.line}</td><td><span className={"badge " + STATUS[r.status][1]}>{STATUS[r.status][0]}</span></td>
                    <td>{r.nom}</td><td>{r.ville}</td><td>{r.niche}</td><td>{r.zone}</td><td>{r.offre}</td>
                    <td className="nowrap">{r.note != null ? `${r.note} (${r.avis ?? 0})` : r.avis != null ? `(${r.avis})` : ""}</td>
                    <td className="small">
                      {r.error && <span className="err">{r.error}</span>}
                      {r.dup && <>existe : <Link href={`/commerces/${r.dup.id}`} target="_blank">{r.dup.nom}</Link> ({r.dup.reason})</>}
                      {r.internalOf && <>même commerce que la ligne {r.internalOf} (ignorée)</>}
                      {r.statut && r.statut !== "a_contacter" && <div className="muted">statut : {statutLabel(r.statut)}</div>}
                      {r.warnings.map((w) => <div key={w} style={{ color: "var(--warn)" }}>{w}</div>)}
                    </td>
                  </tr>))}
                  {prev.rows.length === 0 && <tr><td colSpan={9} className="muted">Aucune ligne.</td></tr>}
                </tbody>
              </table>
            </div>
            {prev.pages > 1 && (
              <div className="row small">
                <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Préc.</button>
                <span className="muted">Page {prev.page} / {prev.pages} · {prev.count} ligne(s)</span>
                <button className="btn sm" disabled={page >= prev.pages} onClick={() => setPage(page + 1)}>Suiv. →</button>
              </div>
            )}
            {s.duplicates > 0 && (
              <label className="f" style={{ maxWidth: 420 }}>Doublons déjà dans le CRM ({s.duplicates})
                <select value={dup} onChange={(e) => setDup(e.target.value as "ignore" | "update")}>
                  <option value="ignore">Ignorer</option>
                  <option value="update">Mettre à jour (compléter les vides, note/avis/message ; statut jamais rétrogradé)</option>
                </select></label>
            )}
            <div className="row">
              <button className="btn primary" disabled={!!busy || importable === 0} onClick={doImport}>
                {busy === "import" ? "Import en cours…" : `Importer ${s.valid} nouvelle(s) fiche(s)` + (dup === "update" && s.duplicates ? ` + mettre à jour ${s.duplicates}` : "")}
              </button>
              {busy === "import" && <span className="small muted">Ne ferme pas la page.</span>}
            </div>
          </div>
        </>
      )}

      {res && (
        <div className="card stack" style={{ marginTop: 14 }}>
          <div className="banner ok">Import terminé en {res.ms < 1000 ? `${res.ms} ms` : `${(res.ms / 1000).toFixed(1)} s`} : {res.added} ajoutée(s), {res.updated} mise(s) à jour, {res.ignored} ignorée(s), {res.errors} erreur(s).</div>
          <div className="row">
            {res.added > 0 && <Link className="btn primary" href={`/commerces?vue=toutes&lot=${res.batchId}`}>Voir les fiches de cet import →</Link>}
            {res.added > 0 && !cancelMsg && <button className="btn danger" disabled={!!busy} onClick={cancelImport}>{busy === "cancel" ? "Annulation…" : "Annuler cet import"}</button>}
            <button className="btn" onClick={() => { setP(null); setRes(null); setPrev(null); setCancelMsg(""); }}>Importer un autre fichier</button>
          </div>
          {cancelMsg && <p className="small">{cancelMsg}</p>}
        </div>
      )}
    </>
  );
}
