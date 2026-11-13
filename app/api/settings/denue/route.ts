import { NextResponse } from "next/server";
import { denueToken, maskToken, setSetting } from "@/lib/settings";

// Le token n'est JAMAIS renvoyé en clair : seulement un indicateur et les 4 derniers caractères.
export async function GET() {
  const t = denueToken();
  return NextResponse.json({ hasToken: !!t, masked: maskToken(t) });
}
export async function POST(req: Request) {
  const { token } = await req.json();
  setSetting("denue_token", String(token ?? "").trim());
  const t = denueToken();
  return NextResponse.json({ hasToken: !!t, masked: maskToken(t) });
}
