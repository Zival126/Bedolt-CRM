import { NextResponse } from "next/server";
import { denueTest } from "@/lib/denue";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";
export const POST = route(async () => {
  await requireSession();
  return NextResponse.json(await denueTest());
});
