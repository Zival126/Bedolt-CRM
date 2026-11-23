import { NextResponse } from "next/server";
import { z } from "zod";
import { ColumnsSchema, DEFAULT_COLUMNS } from "@/lib/columns";
import { saveColumns, commerceColumns } from "@/lib/views";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

// Colonnes du tableau Commerces (affichées / masquées, ordre).
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, z.object({ columns: ColumnsSchema.optional(), reset: z.boolean().optional() }));
  saveColumns(b.reset || !b.columns ? DEFAULT_COLUMNS : b.columns);
  return NextResponse.json({ columns: commerceColumns() });
});
