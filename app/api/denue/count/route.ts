import { NextResponse } from "next/server";
import { z } from "zod";
import { cuantificar, PAGE } from "@/lib/denue";
import { dedupeCodes, scianTitle } from "@/lib/scian";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({
  codes: z.array(z.string().regex(/^\d{2,6}$/)).min(1).max(30),
  entidad: z.string().regex(/^\d{2}$/).default("23"),
  municipio: z.string().regex(/^\d{0,3}$/).default(""), localidad: z.string().regex(/^\d{0,4}$/).default(""),
  estrato: z.string().regex(/^\d?$/).default(""),
});

// Cuantificar AVANT de chercher : volume par activité et estimation du nombre de pages (PAGE enregistrements / requête).
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  const codes = dedupeCodes(b.codes);
  const area = b.entidad + (b.municipio ? b.municipio.padStart(3, "0") + (b.localidad ? b.localidad.padStart(4, "0") : "") : "");
  try {
    const rows = await cuantificar(codes, [area], b.estrato || "0");
    const by = codes.map((c) => ({ code: c, title: scianTitle(c), total: rows.filter((r) => r.ae === c).reduce((a, r) => a + r.total, 0) }));
    const total = by.reduce((a, x) => a + x.total, 0);
    return NextResponse.json({ total, by, pages: by.reduce((a, x) => a + Math.max(x.total ? 1 : 0, Math.ceil(x.total / PAGE)), 0), pageSize: PAGE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
});
