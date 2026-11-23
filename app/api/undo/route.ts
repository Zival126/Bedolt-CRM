import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { undoResult } from "@/lib/outcomes";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({ undo: zId });

// Bouton « Annuler » du toast : restaure la fiche et supprime les lignes créées par l'action.
export const POST = route(async (req) => {
  await requireSession();
  const { undo } = await readJson(req, Body);
  const r = undoResult(undo);
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, ...r });
});
