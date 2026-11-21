import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { cancelBatch } from "@/lib/import";
import { readJson, route, zId } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

const Body = z.object({ batchId: zId });

export const POST = route(async (req) => {
  await requireSession();
  const { batchId } = await readJson(req, Body);
  const r = cancelBatch(batchId);
  if (!r) throw new HttpError(404, "Lot d'import introuvable.");
  revalidatePath("/", "layout");
  return NextResponse.json(r);
});
