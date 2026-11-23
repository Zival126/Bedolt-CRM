import { NextResponse } from "next/server";
import { z } from "zod";
import { refreshFromDenue } from "@/lib/denue-run";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

// Fiche > « Mettre à jour depuis DENUE » (méthode Ficha).
export const POST = route(async (req) => {
  await requireSession();
  const { id } = await readJson(req, z.object({ id: zId }));
  try {
    const r = await refreshFromDenue(id);
    return NextResponse.json({ changed: r.changed, message: r.changed.length ? `Mis à jour : ${r.changed.join(", ")}.` : "Déjà à jour avec DENUE." });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
});
