import { NextResponse } from "next/server";
import { z } from "zod";
import { commit } from "@/lib/import";
import { MappingSchema, Rows } from "@/lib/import-schema";
import { revalidatePath } from "next/cache";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({ rows: Rows, mapping: MappingSchema, fileName: z.string().max(255).default(""), onDuplicate: z.enum(["ignore", "update"]).default("ignore") });

export const POST = route(async (req) => {
  await requireSession();
  const { rows, mapping, fileName, onDuplicate } = await readJson(req, Body);
  const r = commit(rows, mapping, fileName, onDuplicate);
  revalidatePath("/", "layout");
  return NextResponse.json(r);
});
