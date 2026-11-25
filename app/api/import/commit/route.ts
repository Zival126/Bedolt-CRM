import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { commit, mappingFor } from "@/lib/import";
import { getStaged, dropStaged } from "@/lib/import-store";
import { ImportBase } from "@/lib/import-schema";
import { readJson, route } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/geocode";

const Body = ImportBase.extend({ onDuplicate: z.enum(["ignore", "update"]).default("ignore") });

export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  const s = getStaged(b.token);
  if (!s) throw new HttpError(410, "Fichier expiré (1 h) ou serveur redémarré : renvoie le fichier.");
  const format = b.format ?? s.format;
  const mapping = b.mapping ?? mappingFor(format, s.headers);
  if (mapping.nom === undefined) throw new HttpError(400, "Associe la colonne du nom (Entreprise).");
  // Un fichier envoyé = un seul import (un double clic n'importe pas deux fois).
  if (s.done) throw new HttpError(409, "Ce fichier a déjà été importé.");
  s.done = true;
  let r;
  try {
    r = commit(s, mapping, { defaultVille: b.defaultVille, nicheChoices: b.nicheChoices, fileName: s.fileName, format, onDuplicate: b.onDuplicate });
  } catch (e) {
    s.done = false;
    console.error("[bedolt-crm] import annulé (rollback)", e);
    throw new HttpError(500, "Import interrompu : rien n'a été enregistré (transaction annulée). Réessaie.");
  }
  dropStaged(b.token);
  // Géocodage en arrière-plan des fiches du lot sans position (nouvelles et mises à jour) : n'attend pas.
  const ids = (db.prepare("SELECT id FROM businesses WHERE import_batch_id = ? AND lat IS NULL").all(r.batchId) as { id: number }[]).map((x) => x.id);
  const geo = enqueue(ids);
  revalidatePath("/", "layout");
  return NextResponse.json({ ...r, geocoding: geo });
});
