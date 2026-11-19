import { NextResponse } from "next/server";
import { z } from "zod";
import { denueToken, maskToken, setSetting } from "@/lib/settings";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({ token: z.string().trim().max(200).regex(/^[\w-]*$/, "le token ne contient que lettres, chiffres et tirets") });

// Le token n'est JAMAIS renvoyé en clair : seulement un indicateur et les 4 derniers caractères.
export const GET = route(async () => {
  await requireSession();
  const t = denueToken();
  return NextResponse.json({ hasToken: !!t, masked: maskToken(t) });
});
export const POST = route(async (req) => {
  await requireSession();
  const { token } = await readJson(req, Body);
  setSetting("denue_token", token);
  const t = denueToken();
  return NextResponse.json({ hasToken: !!t, masked: maskToken(t) });
});
