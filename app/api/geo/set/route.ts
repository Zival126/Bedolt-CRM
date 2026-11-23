import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getBusiness } from "@/lib/crm";
import { setManualPosition, resetPosition } from "@/lib/geocode";
import { parseCoords } from "@/lib/geo";
import { readJson, route, zId } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

const Body = z.union([
  z.object({ id: zId, lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict(),
  z.object({ id: zId, text: z.string().trim().min(1).max(3000) }).strict(),   // coordonnées ou lien Google Maps collé
  z.object({ id: zId, reset: z.literal(true) }).strict(),                     // retour au géocodage automatique
]);

// Correction manuelle de la position (fiche) : geo_source = manuel, jamais écrasée par le géocodage automatique.
export const POST = route(async (req) => {
  await requireSession();
  const b = await readJson(req, Body);
  if (!getBusiness(b.id)) throw new HttpError(404, "Commerce introuvable.");
  if ("reset" in b) {
    resetPosition(b.id);
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true, message: "Position effacée : géocodage automatique relancé." });
  }
  let p: { lat: number; lng: number } | null;
  if ("text" in b) {
    p = parseCoords(b.text);
    if (!p) throw new HttpError(400, /goo\.gl|maps\.app/i.test(b.text)
      ? "Lien court sans coordonnées : ouvre-le dans le navigateur puis copie l'adresse complète (avec @21.1…,-86.8…)."
      : "Aucune coordonnée trouvée. Exemple : 21.1619, -86.8515 ou un lien Google Maps complet.");
  } else p = { lat: b.lat, lng: b.lng };
  if (p.lat === 0 && p.lng === 0) throw new HttpError(400, "Coordonnées invalides (0, 0).");
  setManualPosition(b.id, p.lat, p.lng);
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, lat: p.lat, lng: p.lng, message: "Position enregistrée (manuelle)." });
});
