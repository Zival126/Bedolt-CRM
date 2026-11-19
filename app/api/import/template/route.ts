import { buildTemplate } from "@/lib/import";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

export const GET = route(async () => {
  await requireSession();
  return new Response(new Uint8Array(await buildTemplate()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modele-import-bedolt.xlsx"',
    },
  });
});
