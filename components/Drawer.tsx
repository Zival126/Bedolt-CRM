"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";

/**
 * Panneau latéral (ordinateur) / feuille du bas (téléphone), ouvert par un bouton. Le contenu (souvent un formulaire
 * GET rendu côté serveur) reste dans la page : les filtres vivent dans l'URL.
 */
export default function Drawer({ label, title, count, children, footer, className = "btn", open: openInit = false }: {
  label: React.ReactNode; title: string; count?: number; children: React.ReactNode; footer?: React.ReactNode; className?: string; open?: boolean;
}) {
  const [open, setOpen] = useState(openInit);
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open]);
  return (
    <>
      <button type="button" className={className} aria-expanded={open} onClick={() => setOpen(true)}>{label}{count ? <span className="fcount">{count}</span> : null}</button>
      <div hidden={!open}>
        <div className="drawer-bg" onClick={() => setOpen(false)} />
        <div className="drawer" role="dialog" aria-modal="true" aria-label={title}>
          <div className="drawer-h"><b>{title}</b><button type="button" className="btn ghost icon" aria-label="Fermer" onClick={() => setOpen(false)}><Icon name="close" size={18} /></button></div>
          {children}
          {footer}
        </div>
      </div>
    </>
  );
}

/** Menu « ⋯ » des actions secondaires (se ferme au clic extérieur). */
export function MoreMenu({ children, label = "Plus d'actions" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".more")) setOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  return (
    <div className="more">
      <button type="button" className="btn icon" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>
      {open && <div className="more-menu" role="menu" onClick={(e) => { if ((e.target as HTMLElement).closest("a,button")) setTimeout(() => setOpen(false), 0); }}>{children}</div>}
    </div>
  );
}
