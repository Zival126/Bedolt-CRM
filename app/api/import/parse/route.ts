import { NextResponse } from "next/server";
import { readFile, autoMapping, IMPORT_FIELDS, MAX_IMPORT_BYTES } from "@/lib/import";
import { route } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

const TOO_BIG = "Fichier trop volumineux : 5 Mo maximum.";

export const POST = route(async (req) => {
  await requireSession();
  // Refus avant lecture du corps si la taille annoncée dépasse déjà la limite (marge pour l'enveloppe multipart).
  if (Number(req.headers.get("content-length") ?? 0) > MAX_IMPORT_BYTES + 64 * 1024) throw new HttpError(400, TOO_BIG);
  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, "Envoi de fichier invalide."); }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Aucun fichier.");
  if (file.size > MAX_IMPORT_BYTES) throw new HttpError(400, TOO_BIG);
  try {
    const { headers, rows } = await readFile(file.name, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ fileName: file.name.slice(0, 255), headers, rows, mapping: autoMapping(headers), fields: IMPORT_FIELDS });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
});
