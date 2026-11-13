import { NextResponse } from "next/server";
import { readFile, autoMapping, IMPORT_FIELDS } from "@/lib/import";

export async function POST(req: Request) {
  try {
    const file = (await req.formData()).get("file") as File | null;
    if (!file) throw new Error("Aucun fichier.");
    const { headers, rows } = await readFile(file.name, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ fileName: file.name, headers, rows, mapping: autoMapping(headers), fields: IMPORT_FIELDS });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
