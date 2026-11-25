import { NextResponse } from "next/server";
import { z } from "zod";
import { addCandidates } from "@/lib/sources";
import { forStorage } from "@/lib/places-api";
import { CandidateSchema } from "@/lib/candidate-schema";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({
  items: z.array(CandidateSchema).min(1).max(5000), label: z.string().trim().max(100).default(""),
  // Zone de la recherche (paramètres de l'utilisateur) : seule localisation gardée pour une source API en stockage « identifiant »
  zone: z.object({ ville: z.string().trim().max(200).default(""), etat_code: z.string().regex(/^\d{2}$/).optional(), municipio_code: z.string().regex(/^\d{3}$/).optional() }).default({ ville: "" }),
});

// Ajout depuis OSM / Overture : nouvelles fiches, ou fusion dans la fiche existante (champs vides complétés).
export const POST = route(async (req) => {
  await requireSession();
  const { items, label, zone } = await readJson(req, Body);
  // Les niches ne sont jamais créées ici : une niche inconnue est simplement ignorée (texte gardé seulement s'il existe)
  return NextResponse.json(addCandidates(items.map((c) => forStorage(c, zone)), label));
});
