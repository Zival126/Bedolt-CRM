import { NextResponse } from "next/server";
import { z } from "zod";
import { denueSearch } from "@/lib/denue";
import { findDuplicate } from "@/lib/crm";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const digits = (max: number, label: string) => z.string().trim().regex(new RegExp(`^\\d{0,${max}}$`), `${label} : ${max} chiffres maximum`).default("");
const page = z.number().int().min(1).max(10_000);
const size = z.number().int().min(1).max(100);
const Search = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("zone"), entidad: digits(2, "entidad"), municipio: digits(3, "municipio"), scian: digits(6, "SCIAN"), strate: digits(1, "strate"), page, size }),
  z.object({ mode: z.literal("nom"), nom: z.string().trim().min(1).max(100), entidad: digits(2, "entidad"), page, size }),
  z.object({ mode: z.literal("point"), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), rayon: z.number().min(1).max(5000), condition: z.string().max(100).default("") }),
]);

export const POST = route(async (req) => {
  await requireSession();
  const s = await readJson(req, Search);
  try {
    const rows = await denueSearch(s);
    // Badge « déjà dans le CRM » : ID DENUE puis téléphone normalisé.
    const out = rows.map((r) => ({ ...r, existingId: findDuplicate({ denue_id: r.clee, telephone: r.telephone })?.id ?? null }));
    return NextResponse.json({ rows: out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
});
