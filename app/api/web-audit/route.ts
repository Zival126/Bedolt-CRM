import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditBusiness, enqueueWebAudit, webAuditStatus, webAudit } from "@/lib/web-audit";
import { idsForFilter } from "@/lib/crm";
import { readFilters } from "@/lib/filters";
import { withQueue } from "@/lib/queue";
import { readJson, route, zId } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("one"), id: zId }),                                         // fiche : analyse immédiate
  z.object({ action: z.literal("queue"), ids: z.array(zId).max(5000).optional(), query: z.string().max(4000).optional(), all: z.boolean().optional(), force: z.boolean().default(false) }),
]);

// Analyse de présence web (sans IA) : par fiche ou en lot (file en arrière-plan).
export const GET = route(async () => {
  await requireSession();
  return NextResponse.json(webAuditStatus(), { headers: { "Cache-Control": "no-store" } });
});
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  if (b.action === "one") {
    const a = await auditBusiness(b.id);
    revalidatePath("/", "layout");
    return NextResponse.json({ audit: a ? webAudit(b.id) : null });
  }
  const ids = b.all ? undefined : b.ids ?? idsForFilter(withQueue(readFilters(Object.fromEntries(new URLSearchParams(b.query ?? ""))).f), 5000);
  const added = enqueueWebAudit(ids, b.force);
  return NextResponse.json({ added, status: webAuditStatus() });
});
