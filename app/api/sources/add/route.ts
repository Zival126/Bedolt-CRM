import { NextResponse } from "next/server";
import { z } from "zod";
import { addCandidates } from "@/lib/sources";
import { CandidateSchema } from "@/lib/candidate-schema";
import { readJson, route } from "@/lib/api";
import { requireSession } from "@/lib/session";

const Body = z.object({ items: z.array(CandidateSchema).min(1).max(5000), label: z.string().trim().max(100).default("") });

// Ajout depuis OSM / Overture : nouvelles fiches, ou fusion dans la fiche existante (champs vides complétés).
export const POST = route(async (req) => {
  await requireSession();
  const { items, label } = await readJson(req, Body);
  return NextResponse.json(addCandidates(items, label));
});
