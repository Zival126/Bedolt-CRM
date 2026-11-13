import { buildTemplate } from "@/lib/import";
export async function GET() {
  return new Response(new Uint8Array(await buildTemplate()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modele-import-bedolt.xlsx"',
    },
  });
}
