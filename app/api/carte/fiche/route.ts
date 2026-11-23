import { NextResponse } from "next/server";
import { getBusiness, dayCounts } from "@/lib/crm";
import { panelItem } from "@/lib/panel";
import { stageInfo } from "@/lib/rows";
import { stageOf, STAGE_LABEL } from "@/lib/stage";
import { objectives } from "@/lib/settings";
import { prettyPhone, mapsPlaceUrl } from "@/lib/phone";
import { isExact, precisionText, sourceLabel, directionsUrl } from "@/lib/geo";
import { parse, route, zId } from "@/lib/api";
import { HttpError, requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Détails d'un point cliqué sur la carte : infos de la bulle + données des boutons de résultat (même logique que la file).
export const GET = route(async (req) => {
  await requireSession();
  const id = parse(zId, new URL(req.url).searchParams.get("id"));
  const b = getBusiness(id);
  if (!b) throw new HttpError(404, "Commerce introuvable.");
  const o = objectives();
  const stage = stageOf(b);
  const exact = isExact(b.geo_precision);
  const dest = b.lat != null && b.lng != null && exact
    ? directionsUrl(b.lat, b.lng)
    : "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent([b.nom, b.adresse, b.ville].filter(Boolean).join(" "));
  return NextResponse.json({
    id: b.id, nom: b.nom, niche: b.niche || b.activite, zone: b.zone || b.colonia, ville: b.ville, offre: b.offre,
    note: b.note_google, avis: b.nb_avis, statut: b.statut, motif: b.perdu_motif, angle: b.angle, web: b.presence_web,
    lat: b.lat, lng: b.lng, precision: b.geo_precision, exact, precisionText: precisionText(b.geo_precision), source: sourceLabel(b.geo_source),
    tel: b.tel_norm ? `tel:+52${b.tel_norm}` : "", telLabel: b.tel_norm ? prettyPhone(b.telephone || b.tel_norm) : "",
    maps: mapsPlaceUrl(b), directions: dest, stage, stageLabel: STAGE_LABEL[stage], info: stageInfo(b, stage),
    panel: panelItem(b, { stage, hardLeft: o.newHard - dayCounts().newWa, hard: o.newHard }),
  }, { headers: { "Cache-Control": "no-store" } });
});
