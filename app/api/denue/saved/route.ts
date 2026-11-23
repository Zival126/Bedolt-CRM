import { NextResponse } from "next/server";
import { z } from "zod";
import { SearchParamsSchema, existingIndex } from "@/lib/denue-run";
import { savedSearches, saveSearch, deleteSearch, setWatch, runSaved, newRows, dismissNew } from "@/lib/denue-watch";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: zId.optional(), name: z.string().trim().min(1).max(100), params: SearchParamsSchema, watch: z.boolean().default(false), seen: z.array(z.string().max(40)).max(50_000).default([]) }),
  z.object({ action: z.literal("delete"), id: zId }),
  z.object({ action: z.literal("watch"), id: zId, watch: z.boolean() }),
  z.object({ action: z.literal("run"), id: zId }),
  z.object({ action: z.literal("news"), id: zId }),
  z.object({ action: z.literal("dismiss"), id: zId, clees: z.array(z.string().max(40)).max(50_000).optional() }),
]);

export const GET = route(async () => {
  await requireSession();
  return NextResponse.json({ searches: savedSearches() });
});

export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  switch (b.action) {
    case "save": return NextResponse.json({ id: saveSearch(b), searches: savedSearches() });
    case "delete": deleteSearch(b.id); break;
    case "watch": setWatch(b.id, b.watch); break;
    case "run": { const r = await runSaved(b.id); return NextResponse.json({ ...r, searches: savedSearches() }); }
    case "news": { const find = existingIndex(); return NextResponse.json({ rows: newRows(b.id).map((x) => ({ ...x, existing: find(x) })) }); }
    case "dismiss": dismissNew(b.id, b.clees); break;
  }
  return NextResponse.json({ searches: savedSearches() });
});
