import { NextResponse } from "next/server";
import { z } from "zod";
import { savedViews, saveView, deleteView } from "@/lib/views";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), name: z.string().trim().min(1).max(80), query: z.string().max(4000) }),
  z.object({ action: z.literal("delete"), id: zId }),
]);

// Vues enregistrées de Commerces (ex. « Beauté Cancún sans site avec email ») : nom + filtres de l'URL.
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  if (b.action === "save") saveView(b.name, b.query); else deleteView(b.id);
  return NextResponse.json({ views: savedViews() });
});
