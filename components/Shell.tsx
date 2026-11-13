"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ChatPanel from "./ChatPanel";

const LINKS = [
  ["/", "Aujourd'hui"], ["/commerces", "Commerces"], ["/pipeline", "Pipeline"], ["/denue", "DENUE"], ["/import", "Import"],
  ["/clients", "Clients"], ["/semaine", "Semaine"], ["/reglages", "Réglages"],
] as const;

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/login") return <>{children}</>;
  return (
    <>
      <nav className="nav">
        <div className="brand">Bedolt <span className="muted">CRM</span></div>
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className={(href === "/" ? path === "/" : path.startsWith(href)) ? "active" : ""}>{label}</Link>
        ))}
        <form action="/api/logout" method="post"><button className="btn sm" style={{ width: "100%" }}>Déconnexion</button></form>
      </nav>
      <main className="page">{children}</main>
      <ChatPanel />
    </>
  );
}
