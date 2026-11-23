import { NextResponse } from "next/server";
import { z } from "zod";
import { addRows, AddItemSchema } from "@/lib/denue-run";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({ items: z.array(AddItemSchema).min(1).max(5000), label: z.string().trim().max(100).default("") });

// « Ajouter la sélection » / « Ajouter tous les filtrés » : une transaction, doublons ignorés (identifiant renvoyé).
export const POST = route(async (req) => {
  await requireSession();
  const { items, label } = await readJson(req, Body);
  return NextResponse.json(addRows(items, label));
});
