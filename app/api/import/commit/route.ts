import { NextResponse } from "next/server";
import { commit } from "@/lib/import";
import { revalidatePath } from "next/cache";
export async function POST(req: Request) {
  const { rows, mapping, fileName, onDuplicate } = await req.json();
  const r = commit(rows, mapping, fileName, onDuplicate === "update" ? "update" : "ignore");
  revalidatePath("/", "layout");
  return NextResponse.json(r);
}
