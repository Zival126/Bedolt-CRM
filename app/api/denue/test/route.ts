import { NextResponse } from "next/server";
import { denueTest } from "@/lib/denue";
export async function POST() { return NextResponse.json(await denueTest()); }
