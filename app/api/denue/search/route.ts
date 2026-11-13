import { NextResponse } from "next/server";
import { denueSearch, type Search } from "@/lib/denue";
import { findDuplicate } from "@/lib/crm";

export async function POST(req: Request) {
  try {
    const s = (await req.json()) as Search;
    const rows = await denueSearch(s);
    // Badge « déjà dans le CRM » : ID DENUE puis téléphone normalisé.
    const out = rows.map((r) => ({ ...r, existingId: findDuplicate({ denue_id: r.clee, telephone: r.telephone })?.id ?? null }));
    return NextResponse.json({ rows: out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
