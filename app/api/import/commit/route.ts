import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { commit, mappingFor } from "@/lib/import";
import { getStaged, dropStaged } from "@/lib/import-store";
import { ImportBase } from "@/lib/import-schema";
import { readJson, route } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

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
    r = commit(s, mapping, { defaultVille: b.defaultVille, fileName: s.fileName, format, onDuplicate: b.onDuplicate });
  } catch (e) {
    s.done = false;
    console.error("[bedolt-crm] import annulé (rollback)", e);
    throw new HttpError(500, "Import interrompu : rien n'a été enregistré (transaction annulée). Réessaie.");
  }
  dropStaged(b.token);
  revalidatePath("/", "layout");
  return NextResponse.json(r);
});
