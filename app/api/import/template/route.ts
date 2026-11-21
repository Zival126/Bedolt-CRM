import { buildTemplate } from "@/lib/import";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

export const GET = route(async (req) => {
  await requireSession();
  const standard = new URL(req.url).searchParams.get("format") === "standard";
  return new Response(new Uint8Array(await buildTemplate(standard ? "standard" : "bedolt")), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${standard ? "modele-import-bedolt-standard.xlsx" : "modele-prospects-bedolt.xlsx"}"`,
    },
  });
});
