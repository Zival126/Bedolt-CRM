import Link from "next/link";
import { hrefWith, type SP } from "@/lib/filters";

export default function Pager({ base, sp, page, pages, total }: { base: string; sp: SP; page: number; pages: number; total: number }) {
  if (pages <= 1) return null;
  const href = (p: number) => hrefWith(base, sp, { page: String(p) });
  const around = [...new Set([1, page - 1, page, page + 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  return (
    <nav className="pager small" aria-label="Pagination">
      {page > 1 ? <Link className="btn sm" href={href(page - 1)}>← Préc.</Link> : <span className="btn sm off">← Préc.</span>}
      {around.map((p, i) => (
        <span key={p} className="row" style={{ gap: 6 }}>
          {i > 0 && p - around[i - 1] > 1 && <span className="muted">…</span>}
          {p === page ? <span className="btn sm" style={{ borderColor: "var(--accent)" }}>{p}</span> : <Link className="btn sm" href={href(p)}>{p}</Link>}
        </span>
      ))}
      {page < pages ? <Link className="btn sm" href={href(page + 1)}>Suiv. →</Link> : <span className="btn sm off">Suiv. →</span>}
      <span className="muted">page {page}/{pages} · {total.toLocaleString("fr-FR")} fiches</span>
    </nav>
  );
}
