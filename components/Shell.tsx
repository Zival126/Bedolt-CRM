"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import ChatPanel from "./ChatPanel";
import Icon from "./Icon";
import { Toaster } from "./Toast";
import PendingWa from "./PendingWa";
import GlobalSearch from "./GlobalSearch";

type Item = { href: string; label: string; icon: string; count?: "reponses" | "denue" };
const GROUPS: { title: string; items: Item[] }[] = [
  { title: "Travail", items: [{ href: "/", label: "Aujourd'hui", icon: "today", count: "reponses" }, { href: "/focus", label: "Mode focus", icon: "focus" }, { href: "/pipeline", label: "Pipeline", icon: "pipeline" }] },
  { title: "Prospects", items: [{ href: "/commerces", label: "Commerces", icon: "commerces" }, { href: "/carte", label: "Carte", icon: "map" }, { href: "/niches", label: "Niches", icon: "niches" }] },
  { title: "Trouver des prospects", items: [{ href: "/sources", label: "Sources", icon: "sources", count: "denue" }] },
  { title: "Clients", items: [{ href: "/clients", label: "Clients", icon: "clients" }, { href: "/stats", label: "Stats", icon: "stats" }] },
  { title: "", items: [{ href: "/reglages", label: "Réglages", icon: "reglages" }] },
];
const ALL = GROUPS.flatMap((g) => g.items);
const BOTTOM = ["/", "/focus", "/commerces", "/carte"];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
type Counts = { reponses: number; denue: number };

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const [search, setSearch] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const login = path === "/login";

  // Compteurs (réponses à traiter, nouveaux DENUE) : relus à chaque changement de page.
  useEffect(() => {
    if (login) return;
    let stop = false;
    fetch("/api/nav", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!stop && j) setCounts(j); }).catch(() => {});
    return () => { stop = true; };
  }, [path, login]);
  // « / » ou Ctrl+K : recherche globale
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,select,[contenteditable]")) return;
      if (e.key === "/" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) { e.preventDefault(); setSearch(true); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  useEffect(() => { setMore(false); setSearch(false); }, [path]);

  if (login) return <>{children}</>;
  const focus = path === "/focus";
  const carte = path === "/carte";
  const moreActive = ALL.some((i) => !BOTTOM.includes(i.href) && isActive(path, i.href));
  const badge = (i: Item) => {
    const n = i.count && counts ? counts[i.count] : 0;
    return n > 0 ? <span className="nav-count" aria-label={`${n} à traiter`}>{n > 99 ? "99+" : n}</span> : null;
  };
  const link = (i: Item) => (
    <Link key={i.href} href={i.href} className={isActive(path, i.href) ? "active" : ""} aria-current={isActive(path, i.href) ? "page" : undefined}>
      <Icon name={i.icon} /><span className="nav-l">{i.label}</span>{badge(i)}
    </Link>
  );
  return (
    <>
      {!focus && (
        <>
          <nav className="side" aria-label="Navigation">
            <div className="brand"><span className="logo">B</span>Bedolt <span className="muted">CRM</span></div>
            <button type="button" className="side-search" onClick={() => setSearch(true)}><Icon name="search" size={16} /><span>Rechercher…</span><kbd>/</kbd></button>
            {GROUPS.map((g, i) => (
              <div key={i} className="nav-group">
                {g.title && <div className="nav-title">{g.title}</div>}
                {g.items.map(link)}
              </div>
            ))}
            <form action="/api/logout" method="post" style={{ marginTop: "auto" }}><button className="btn ghost wide"><Icon name="logout" size={16} />Déconnexion</button></form>
          </nav>
          <nav className="bottom" aria-label="Navigation">
            {ALL.filter((i) => BOTTOM.includes(i.href)).map((i) => (
              <Link key={i.href} href={i.href} className={isActive(path, i.href) ? "active" : ""} aria-current={isActive(path, i.href) ? "page" : undefined}>
                <span className="bi"><Icon name={i.icon} />{badge(i)}</span><span>{i.label === "Mode focus" ? "Focus" : i.label}</span></Link>
            ))}
            <button type="button" className={moreActive || more ? "active" : ""} onClick={() => setMore(!more)} aria-expanded={more}>
              <span className="bi"><Icon name="plus" />{counts && counts.denue > 0 && !more ? <span className="nav-dot" /> : null}</span><span>Plus</span></button>
          </nav>
          {more && (
            <div className="sheet-bg" onClick={() => setMore(false)}>
              <div className="sheet nav-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Plus de pages">
                <button type="button" className="side-search wide" onClick={() => { setMore(false); setSearch(true); }}><Icon name="search" size={16} /><span>Rechercher un commerce (nom, téléphone)</span></button>
                {GROUPS.map((g, i) => (
                  <div key={i} className="nav-group">
                    {g.title && <div className="nav-title">{g.title}</div>}
                    <div className="nav-grid">{g.items.map(link)}</div>
                  </div>
                ))}
                <form action="/api/logout" method="post"><button className="btn ghost wide">Déconnexion</button></form>
              </div>
            </div>
          )}
        </>
      )}
      <main className={focus ? "page focus-page" : carte ? "page map-page" : "page"}>{children}</main>
      {search && <GlobalSearch onClose={() => setSearch(false)} />}
      {!focus && !carte && <ChatPanel />}
      <Toaster />
      <PendingWa />
    </>
  );
}
