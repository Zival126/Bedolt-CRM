"use client";
import { useEffect, useState } from "react";
import { getJson } from "../client-api";
import { STRATES } from "./types";

type Cell = { denue: number | null; crm: number; contactes: number; clients: number };
type M = { niches: { label: string; codes: string[] }[]; municipios: { code: string; nom: string }[]; cells: Record<string, Cell>; estrato: string; entidad: string; par: "municipio" | "etat"; truncated: number; error?: string };
type Z = { ent: string; mun: string; loc: string; label: string };
const n = (x: number) => x.toLocaleString("fr-FR");

// « Marché » : mes niches × municipios d'un État (défaut Quintana Roo), ou × les 32 États — établissements DENUE
// (Cuantificar) vs fiches du CRM. Un clic sur une case lance la recherche correspondante.
export default function Market({ onOpen, entidades }: { onOpen: (codes: string[], zone: Z, estrato: string) => void; entidades: { code: string; nom: string }[] }) {
  const [estrato, setEstrato] = useState("");
  const [ent, setEnt] = useState("23");
  const [par, setPar] = useState<"municipio" | "etat">("municipio");
  const [m, setM] = useState<M | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let stale = false;
    setM(null); setErr("");
    getJson<M>(`/api/denue/market?estrato=${estrato || "0"}&entidad=${ent}&par=${par}`).then((r) => { if (!stale) setM(r); }).catch((e) => !stale && setErr(e.message));
    return () => { stale = true; };
  }, [estrato, ent, par]);
  const entName = (c: string) => entidades.find((e) => e.code === c)?.nom ?? c;
  const zoneOf = (code: string): Z => (par === "etat" ? { ent: code, mun: "", loc: "", label: entName(code) }
    : { ent, mun: code, loc: "", label: `${m?.municipios.find((x) => x.code === code)?.nom ?? code} (${entName(ent)})` });

  const total = (label: string, k: keyof Cell) => m ? m.municipios.reduce((a, mu) => a + (m.cells[`${label}|${mu.code}`]?.[k] ?? 0), 0) : 0;
  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="row spread">
        <p className="small muted" style={{ margin: 0 }}>Établissements recensés par DENUE (Cuantificar, mis en cache 24 h) face aux fiches du CRM de la même niche. Clique sur une case pour lancer la recherche.</p>
      </div>
      <div className="row">
        <div className="tabs" style={{ margin: 0 }}>
          <button type="button" className={par === "municipio" ? "on" : ""} onClick={() => setPar("municipio")}>Par municipio</button>
          <button type="button" className={par === "etat" ? "on" : ""} onClick={() => setPar("etat")}>Par État (32)</button>
        </div>
        {par === "municipio" && <select value={ent} onChange={(e) => setEnt(e.target.value)} style={{ width: "auto" }} aria-label="État">
          {entidades.map((e) => <option key={e.code} value={e.code}>{e.nom}</option>)}</select>}
        <select value={estrato} onChange={(e) => setEstrato(e.target.value)} style={{ width: "auto" }} aria-label="Strate">
          {STRATES.map(([v, l]) => <option key={v} value={v}>{v ? `Strate : ${l}` : "Toutes tailles"}</option>)}</select>
      </div>
      {m && m.truncated > 0 && <div className="banner warn small">{entName(ent)} compte {m.truncated + m.municipios.length} municipios : les {m.municipios.length} plus peuplés sont affichés.</div>}
      {err && <div className="banner bad">{err}</div>}
      {!m && !err && <div className="empty">Comptage DENUE…</div>}
      {m?.error && <div className="banner warn">{m.error} — seuls les chiffres du CRM sont affichés.</div>}
      {m && m.niches.length === 0 && <div className="empty">Aucune niche avec des codes SCIAN : ajoute-les dans la page Niches.</div>}
      {m && m.niches.length > 0 && (
        <div className="market-wrap">
          <table className="market">
            <thead><tr><th>Niche</th>{m.municipios.map((mu) => <th key={mu.code} title={`${par === "etat" ? "entidad" : "municipio"} ${mu.code}`}>{mu.nom}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {m.niches.map((ni) => (
                <tr key={ni.label}>
                  <th scope="row">{ni.label}<div className="tiny muted">{ni.codes.length} code(s)</div></th>
                  {m.municipios.map((mu) => {
                    const c = m.cells[`${ni.label}|${mu.code}`];
                    const pct = c.denue ? Math.min(100, Math.round((c.crm / c.denue) * 100)) : 0;
                    return (
                      <td key={mu.code}>
                        <button type="button" className="mcell" onClick={() => onOpen(ni.codes, zoneOf(mu.code), estrato)} title={`Rechercher ${ni.label} à ${mu.nom}`}>
                          <b>{c.denue == null ? "?" : n(c.denue)}</b>
                          <span className={"tiny" + (c.crm ? "" : " muted")}>CRM {n(c.crm)}{c.denue && c.crm ? ` · ${pct} %` : ""}</span>
                          {(c.contactes > 0 || c.clients > 0) && <span className="tiny muted" title={`${c.contactes} contactés · ${c.clients} clients`}>{n(c.contactes)} cont. · {n(c.clients)} cl.</span>}
                          {c.denue ? <i className="mbar"><i style={{ width: pct + "%" }} /></i> : null}
                        </button>
                      </td>
                    );
                  })}
                  <td><div className="mtotal"><b>{n(total(ni.label, "denue"))}</b><span className="tiny">CRM {n(total(ni.label, "crm"))}</span></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
