import { buildCsv } from "@/lib/export-csv";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Export CSV des fiches filtrées (mêmes paramètres d'URL que la liste), colonnes visibles du tableau (ou cols=…).
 * UTF-8 avec BOM, séparateur « ; » par défaut (Excel en français) ou « , » (sep=,).
 */
export const GET = route(async (req) => {
  await requireSession();
  const { body } = buildCsv(Object.fromEntries(new URL(req.url).searchParams));
  const name = `commerces-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(body, { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store",
  } });
});
