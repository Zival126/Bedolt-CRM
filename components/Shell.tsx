"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import ChatPanel from "./ChatPanel";
import Icon from "./Icon";
import { Toaster } from "./Toast";
import PendingWa from "./PendingWa";

const ALL = [
  ["/", "Aujourd'hui", "today"], ["/focus", "Focus", "focus"], ["/commerces", "Commerces", "commerces"], ["/pipeline", "Pipeline", "pipeline"],
  ["/clients", "Clients", "clients"], ["/stats", "Stats", "stats"], ["/import", "Import", "import"], ["/denue", "DENUE", "denue"], ["/reglages", "Réglages", "reglages"],
] as const;
const BOTTOM = ["/", "/focus", "/commerces", "/pipeline"];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  if (path === "/login") return <>{children}</>;
  const focus = path === "/focus";
  const moreActive = ALL.some(([h]) => !BOTTOM.includes(h) && isActive(path, h));
  return (
    <>
      {!focus && (
        <>
          <nav className="side" aria-label="Navigation">
            <div className="brand"><span className="logo">B</span>Bedolt <span className="muted">CRM</span></div>
            {ALL.map(([href, label, icon]) => (
              <Link key={href} href={href} className={isActive(path, href) ? "active" : ""}><Icon name={icon} />{label}</Link>
            ))}
            <form action="/api/logout" method="post" style={{ marginTop: "auto" }}><button className="btn ghost wide">Déconnexion</button></form>
          </nav>
          <nav className="bottom" aria-label="Navigation">
            {ALL.filter(([h]) => BOTTOM.includes(h)).map(([href, label, icon]) => (
              <Link key={href} href={href} className={isActive(path, href) ? "active" : ""} onClick={() => setMore(false)}><Icon name={icon} /><span>{label}</span></Link>
            ))}
            <button type="button" className={moreActive || more ? "active" : ""} onClick={() => setMore(!more)} aria-expanded={more}><Icon name="plus" /><span>Plus</span></button>
          </nav>
          {more && (
            <div className="sheet-bg" onClick={() => setMore(false)}>
              <div className="sheet" onClick={(e) => e.stopPropagation()}>
                {ALL.filter(([h]) => !BOTTOM.includes(h)).map(([href, label, icon]) => (
                  <Link key={href} href={href} className={isActive(path, href) ? "active" : ""} onClick={() => setMore(false)}><Icon name={icon} />{label}</Link>
                ))}
                <form action="/api/logout" method="post"><button className="btn ghost wide">Déconnexion</button></form>
              </div>
            </div>
          )}
        </>
      )}
      <main className={focus ? "page focus-page" : "page"}>{children}</main>
      {!focus && <ChatPanel />}
      <Toaster />
      <PendingWa />
    </>
  );
}
