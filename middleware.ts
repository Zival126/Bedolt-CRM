import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verifyToken } from "@/lib/auth";
import { redirectTo } from "@/lib/app-url";

// Première barrière (Edge) : signature + expiration du cookie. La version de session (révocation) est vérifiée
// ensuite côté Node par requireSession() dans chaque route, action et page.
// Ce middleware pose aussi la Content-Security-Policy avec un nonce par requête (Next l'applique à ses scripts).
const PUBLIC = new Set(["/login", "/api/login", "/api/logout"]); // logout : efface seulement le cookie

function csp(nonce: string) {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // attributs style="" de React : pas de nonce possible
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ].join("; ");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = btoa(crypto.randomUUID());
  const policy = csp(nonce);
  const pass = () => {
    const headers = new Headers(req.headers);
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy", policy);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("Content-Security-Policy", policy);
    return res;
  };
  if (PUBLIC.has(pathname)) return pass();
  if (await verifyToken(req.cookies.get(COOKIE)?.value)) return pass();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  return redirectTo("/login"); // APP_URL, jamais req.nextUrl (qui vaut localhost:3100 derrière le proxy)
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
