import { NextResponse } from "next/server";
import { z } from "zod";
import { apiSearch, apiDetails, toCandidate, apiUsage, apiCap, apiEnabled, ApiError, API_KEYS, PROVIDERS, type ApiKey } from "@/lib/places-api";
import { allNiches } from "@/lib/niches";
import { getBusiness, updateBusiness } from "@/lib/crm";
import { recordOrigin, existingIndex } from "@/lib/sources";
import { safeHttpUrl } from "@/lib/phone";
import { isEmail } from "@/lib/contacts";
import { today } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { readJson, route, zId } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

const Prov = z.enum(API_KEYS as [ApiKey, ...ApiKey[]]);
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("search"), provider: Prov, nicheIds: z.array(zId).min(1).max(12),
    lat: z.number().min(14).max(33), lng: z.number().min(-119).max(-86), radius: z.number().int().min(100).max(50_000), limit: z.number().int().min(1).max(100).default(50),
  }),
  z.object({ action: z.literal("details"), provider: Prov, businessId: zId }),
  // « Copier dans la fiche » : champs choisis un par un par l'utilisateur, depuis les infos affichées en direct
  z.object({ action: z.literal("copy"), provider: Prov, businessId: zId, fields: z.object({
    telephone: z.string().trim().max(50).optional(), site_web: z.string().trim().max(500).refine((v) => !v || !!safeHttpUrl(v), "site invalide").optional(),
    email: z.string().trim().max(200).refine((v) => !v || isEmail(v), "email invalide").optional(), adresse: z.string().trim().max(300).optional(),
    specialite: z.string().trim().max(200).optional(), ville: z.string().trim().max(200).optional(),
  }).refine((f) => Object.keys(f).length > 0, "aucun champ") }),
]);

// Sources API de lieux (Foursquare, HERE, TomTom, Google) : une requête par niche choisie (terme de la page Niches).
// Les niches ne sont jamais créées : chaque résultat porte la niche cherchée.
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  try {
    if (b.action === "copy") {
      if (!getBusiness(b.businessId)) throw new HttpError(404, "Commerce introuvable.");
      updateBusiness(b.businessId, b.fields);
      for (const [k, v] of Object.entries(b.fields)) if (v) recordOrigin(b.businessId, k, v, `${PROVIDERS[b.provider].label} · ${today()} · copié par toi`);
      revalidatePath("/", "layout");
      return NextResponse.json({ ok: true });
    }
    if (b.action === "details") {
      const biz = getBusiness(b.businessId);
      const id = biz?.[PROVIDERS[b.provider].idCol];
      if (!biz || !id) throw new HttpError(404, "Cette fiche n'a pas d'identifiant pour cette source.");
      return NextResponse.json({ place: await apiDetails(b.provider, id), used: apiUsage(b.provider), cap: apiCap(b.provider), attribution: PROVIDERS[b.provider].attribution });
    }
    if (!apiEnabled(b.provider)) throw new ApiError(`${PROVIDERS[b.provider].label} : clé requise (${PROVIDERS[b.provider].env} dans .env). Rien n'a été envoyé.`, "nokey");
    const niches = allNiches().filter((n) => b.nicheIds.includes(n.id));
    const rows = new Map<string, ReturnType<typeof toCandidate>>();
    let calls = 0, cached = 0;
    const skipped: string[] = [];
    for (const n of niches) {
      const term = n[b.provider].find((v) => !v.startsWith("!")) ?? n.keywords.find((k) => k.length >= 4) ?? n.label;
      if (!term) { skipped.push(n.label); continue; }
      const r = await apiSearch(b.provider, { lat: b.lat, lng: b.lng, radius: b.radius, term, limit: b.limit });
      if (r.cached) cached++; else calls++;
      for (const p of r.places) if (!rows.has(p.id)) rows.set(p.id, toCandidate(b.provider, p, n.label));
    }
    const find = existingIndex();
    return NextResponse.json({
      rows: [...rows.values()].map((c) => ({ ...c, existing: find(c) })), calls, cached, skipped,
      used: apiUsage(b.provider), cap: apiCap(b.provider), attribution: PROVIDERS[b.provider].attribution,
    });
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message, code: e.code, used: apiUsage(b.provider), cap: apiCap(b.provider) }, { status: e.code === "nokey" || e.code === "cap" ? 400 : 502 });
    throw e;
  }
});
