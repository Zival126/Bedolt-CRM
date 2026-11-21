import { NextResponse } from "next/server";
import { readFile, detectFormat, mappingFor, unknownColumns, IMPORT_FIELDS, MAX_IMPORT_BYTES } from "@/lib/import";
import { stage } from "@/lib/import-store";
import { route } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

const TOO_BIG = "Fichier trop volumineux : 5 Mo maximum.";

// Envoi unique du fichier : il est lu et gardé côté serveur ; le navigateur ne reçoit qu'un jeton + les en-têtes.
export const POST = route(async (req) => {
  await requireSession();
  // Refus avant lecture du corps si la taille annoncée dépasse déjà la limite (marge pour l'enveloppe multipart).
  if (Number(req.headers.get("content-length") ?? 0) > MAX_IMPORT_BYTES + 64 * 1024) throw new HttpError(400, TOO_BIG);
  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, "Envoi de fichier invalide."); }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Aucun fichier.");
  if (file.size > MAX_IMPORT_BYTES) throw new HttpError(400, TOO_BIG);
  const fileName = file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 255);
  let data;
  try { data = await readFile(fileName, Buffer.from(await file.arrayBuffer())); }
  catch (e) { throw new HttpError(400, (e as Error).message); }
  const format = detectFormat(data.headers);
  const mapping = mappingFor(format, data.headers);
  const s = stage({ ...data, fileName, format });
  return NextResponse.json({
    token: s.token, fileName, format, headers: data.headers, rowCount: data.rows.length, mapping,
    mappings: { bedolt: mappingFor("bedolt", data.headers), standard: mappingFor("standard", data.headers) },
    unknown: unknownColumns(data.headers, mapping), fields: IMPORT_FIELDS, fileWarnings: data.warnings,
  });
});
