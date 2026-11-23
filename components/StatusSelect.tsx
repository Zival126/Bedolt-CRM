"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeStatus } from "@/app/actions";
import { STATUTS, MOTIFS } from "@/lib/constants";
import { toast } from "./Toast";

// Changement de statut manuel (fiche) : vers « Perdu », le motif est demandé.
export default function StatusSelect({ id, value }: { id: number; value: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lost, setLost] = useState(false);
  const go = (statut: string, motif = "") => start(async () => {
    const r = await changeStatus(id, statut, motif);
    if (r?.error) toast(r.error, { kind: "err" }); else toast("Statut modifié");
    setLost(false); router.refresh();
  });
  return (
    <>
      <select value={lost ? "perdu" : value} disabled={pending} onChange={(e) => (e.target.value === "perdu" ? setLost(true) : go(e.target.value))} style={{ width: "auto" }} aria-label="Statut">
        {STATUTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      {lost && <span className="row">{MOTIFS.map((m) => <button key={m.key} className="btn sm lost" disabled={pending} onClick={() => go("perdu", m.key)}>{m.label}</button>)}
        <button className="btn sm ghost" onClick={() => setLost(false)}>Annuler</button></span>}
    </>
  );
}
