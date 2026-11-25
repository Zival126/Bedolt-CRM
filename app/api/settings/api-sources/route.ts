import { NextResponse } from "next/server";
import { z } from "zod";
import { apiStatus, saveApiSettings, apiSearch, ApiError, API_KEYS, PROVIDERS, type ApiKey } from "@/lib/places-api";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Prov = z.enum(API_KEYS as [ApiKey, ...ApiKey[]]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), provider: Prov, cap: z.number().int().min(0).max(1_000_000).optional(), storage: z.enum(["id", "full"]).optional(), googleRich: z.boolean().optional() }),
  z.object({ action: z.literal("test"), provider: Prov }),
]);

// Réglages > Sources & clés : état des clés (jamais leur valeur), compteur du mois, plafond, mode de stockage, test (1 appel).
export const GET = route(async () => {
  await requireSession();
  return NextResponse.json({ providers: apiStatus() });
});
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  if (b.action === "save") { saveApiSettings(b.provider, b); return NextResponse.json({ providers: apiStatus() }); }
  try {
    const r = await apiSearch(b.provider, { lat: 21.1619, lng: -86.8515, radius: 500, term: b.provider === "tomtom" ? "restaurant" : "restaurante", limit: 1 });
    return NextResponse.json({ ok: true, message: `${PROVIDERS[b.provider].label} répond${r.cached ? " (réponse en cache, aucun appel)" : ""} : ${r.places.length ? `ex. « ${r.places[0].nom} »` : "aucun lieu dans la zone test"}.`, providers: apiStatus() });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof ApiError ? e.message : "Erreur inattendue.", providers: apiStatus() });
  }
});
