"use client";
import { useEffect, useState } from "react";
import { getJson } from "../client-api";
import { STRATES } from "./types";

type Cell = { denue: number | null; crm: number; contactes: number; clients: number };
type M = { niches: { label: string; codes: string[] }[]; municipios: { code: string; nom: string }[]; cells: Record<string, Cell>; estrato: string; error?: string };
const n = (x: number) => x.toLocaleString("fr-FR");

// « Marché » : mes niches × municipios de Quintana Roo — établissements DENUE (Cuantificar) vs fiches du CRM.
// Un clic sur une case lance la recherche correspondante (niche + municipio).
export default function Market({ onOpen }: { onOpen: (codes: string[], municipio: string, estrato: string) => void }) {
  const [estrato, setEstrato] = useState("");
  const [m, setM] = useState<M | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let stale = false;
    setM(null); setErr("");
    getJson<M>("/api/denue/market?estrato=" + (estrato || "0")).then((r) => { if (!stale) setM(r); }).catch((e) => !stale && setErr(e.message));
    return () => { stale = true; };
  }, [estrato]);

  const total = (label: string, k: keyof Cell) => m ? m.municipios.reduce((a, mu) => a + (m.cells[`${label}|${mu.code}`]?.[k] ?? 0), 0) : 0;
  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="row spread">
        <p className="small muted" style={{ margin: 0 }}>Établissements recensés par DENUE (Cuantificar, mis en cache 24 h) face aux fiches du CRM de la même niche. Clique sur une case pour lancer la recherche.</p>
        <select value={estrato} onChange={(e) => setEstrato(e.target.value)} style={{ width: "auto" }} aria-label="Strate">
          {STRATES.map(([v, l]) => <option key={v} value={v}>{v ? `Strate : ${l}` : "Toutes tailles"}</option>)}</select>
      </div>
      {err && <div className="banner bad">{err}</div>}
      {!m && !err && <div className="empty">Comptage DENUE…</div>}
      {m?.error && <div className="banner warn">{m.error} — seuls les chiffres du CRM sont affichés.</div>}
      {m && m.niches.length === 0 && <div className="empty">Aucune niche : crée-les dans Réglages &gt; DENUE &gt; Mes niches.</div>}
      {m && m.niches.length > 0 && (
        <div className="market-wrap">
          <table className="market">
            <thead><tr><th>Niche</th>{m.municipios.map((mu) => <th key={mu.code} title={`municipio ${mu.code}`}>{mu.nom}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {m.niches.map((ni) => (
                <tr key={ni.label}>
                  <th scope="row">{ni.label}<div className="tiny muted">{ni.codes.length} code(s)</div></th>
                  {m.municipios.map((mu) => {
                    const c = m.cells[`${ni.label}|${mu.code}`];
                    const pct = c.denue ? Math.min(100, Math.round((c.crm / c.denue) * 100)) : 0;
                    return (
                      <td key={mu.code}>
                        <button type="button" className="mcell" onClick={() => onOpen(ni.codes, mu.code, estrato)} title={`Rechercher ${ni.label} à ${mu.nom}`}>
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
