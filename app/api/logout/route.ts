import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

export const POST = route(async (req) => {
  await requireSession();
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.delete(COOKIE);
  return res;
});
