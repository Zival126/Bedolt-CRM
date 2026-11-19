import { NextResponse } from "next/server";
import { z } from "zod";
import { COOKIE, cookieOptions, makeToken } from "@/lib/auth";
import { readJson, route } from "@/lib/api";
import { clientIp } from "@/lib/client-ip";
import { authLog, blockedFor, passwordMatches, recordFailure, recordSuccess } from "@/lib/login-guard";
import { sessionVersion } from "@/lib/session";

const Body = z.object({ password: z.string().max(256) });
const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

// Seule route publique (avec la page /login) : pas de requireSession ici, par définition.
export const POST = route(async (req) => {
  const ip = clientIp(req);
  const wait = blockedFor(ip);
  if (wait) {
    authLog("login-blocked", ip);
    return NextResponse.json({ error: `Trop d'essais depuis ton adresse. Réessaie dans ${minutes(wait)} min.` },
      { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } });
  }
  const { password } = await readJson(req, Body);
  if (!passwordMatches(password, process.env.CRM_PASSWORD ?? "")) {
    authLog("login-failed", ip);
    const block = recordFailure(ip);
    if (block) return NextResponse.json({ error: `Mot de passe incorrect. Trop d'essais : bloqué ${minutes(block)} min.` }, { status: 429 });
    return NextResponse.json({ error: "Mot de passe incorrect." }, { status: 401 });
  }
  recordSuccess(ip);
  authLog("login-ok", ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await makeToken(sessionVersion()), cookieOptions);
  return res;
});
