import { NextResponse } from "next/server";
import { status } from "@/lib/ai";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";
export const dynamic = "force-dynamic";
export const GET = route(async () => {
  await requireSession();
  return NextResponse.json(await status());
});
