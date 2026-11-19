import { NextResponse } from "next/server";
import { z } from "zod";
import { preview } from "@/lib/import";
import { MappingSchema, Rows } from "@/lib/import-schema";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({ rows: Rows, mapping: MappingSchema });

export const POST = route(async (req) => {
  await requireSession();
  const { rows, mapping } = await readJson(req, Body);
  return NextResponse.json(preview(rows, mapping));
});
