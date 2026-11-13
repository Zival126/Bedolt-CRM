import { NextResponse } from "next/server";
import { preview } from "@/lib/import";
export async function POST(req: Request) {
  const { rows, mapping } = await req.json();
  return NextResponse.json(preview(rows, mapping));
}
