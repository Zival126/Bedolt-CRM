import { NextResponse } from "next/server";
import { z } from "zod";
import { analyze, summarize, mappingFor, unknownColumns } from "@/lib/import";
import { getStaged } from "@/lib/import-store";
import { ImportBase } from "@/lib/import-schema";
import { readJson, route } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

const PAGE = 50;
const Body = ImportBase.extend({
  page: z.number().int().min(1).max(1000).default(1),
  show: z.enum(["all", "new", "duplicate", "internal", "error", "warning"]).default("all"),
});

export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  const s = getStaged(b.token);
  if (!s) throw new HttpError(410, "Fichier expiré (1 h) ou serveur redémarré : renvoie le fichier.");
  const format = b.format ?? s.format;
  const mapping = b.mapping ?? mappingFor(format, s.headers);
  if (mapping.nom === undefined) throw new HttpError(400, "Associe la colonne du nom (Entreprise).");
  const items = analyze(s, mapping, { defaultVille: b.defaultVille });
  const list = b.show === "all" ? items : b.show === "warning" ? items.filter((x) => x.warnings.length) : items.filter((x) => x.status === b.show);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const page = Math.min(b.page, pages);
  return NextResponse.json({
    summary: summarize(items), unknown: unknownColumns(s.headers, mapping),
    page, pages, count: list.length,
    rows: list.slice((page - 1) * PAGE, page * PAGE).map(({ rec, ...x }) => ({
      ...x, ville: rec?.ville, niche: rec?.niche, zone: rec?.zone, offre: rec?.offre, telephone: rec?.telephone,
      note: rec?.note_google, avis: rec?.nb_avis, statut: rec?.statut, msg: !!rec?.message_whatsapp,
    })),
  });
});
