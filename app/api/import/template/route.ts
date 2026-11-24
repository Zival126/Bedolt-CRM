import { buildTemplate, csvTemplate } from "@/lib/import";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

export const GET = route(async (req) => {
  await requireSession();
  const sp = new URL(req.url).searchParams;
  if (sp.get("format") === "csv") return new Response(csvTemplate(), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="modele-prospects-bedolt.csv"' } });
  const standard = sp.get("format") === "standard";
  return new Response(new Uint8Array(await buildTemplate(standard ? "standard" : "bedolt")), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${standard ? "modele-import-bedolt-standard.xlsx" : "modele-prospects-bedolt.xlsx"}"`,
    },
  });
});
