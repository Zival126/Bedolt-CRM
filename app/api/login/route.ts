import { NextResponse } from "next/server";
import { COOKIE, cookieOptions, makeToken } from "@/lib/auth";

let fails = 0, lastFail = 0; // freinage simple anti brute-force (un seul utilisateur)

export async function POST(req: Request) {
  if (fails >= 5 && Date.now() - lastFail < 60_000) {
    return NextResponse.json({ error: "Trop d'essais, réessaie dans une minute." }, { status: 429 });
  }
  const { password } = await req.json().catch(() => ({ password: "" }));
  if (!process.env.CRM_PASSWORD || password !== process.env.CRM_PASSWORD) {
    fails++; lastFail = Date.now();
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }
  fails = 0;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await makeToken(), cookieOptions);
  return res;
}
