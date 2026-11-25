// Validation des établissements renvoyés par le navigateur pour l'ajout (sources OSM / Overture).
import { z } from "zod";
import { socialHref, isEmail } from "./contacts";
import { safeHttpUrl } from "./phone";

const t = (max: number) => z.string().trim().max(max).default("");
const httpUrl = t(500).transform((v) => safeHttpUrl(v));
const soc = (k: "facebook" | "instagram") => t(500).transform((v) => socialHref(k, v));
export const CandidateSchema = z.object({
  source: z.enum(["osm", "overture", "foursquare", "here", "tomtom", "google"]),
  sourceId: z.string().trim().regex(/^((node|way|relation)\/\d{1,15}|[0-9a-f-]{8,64}|[0-9A-Za-z._:=+/-]{8,200})$/, "identifiant de source invalide"),
  nom: z.string().trim().min(1).max(300), categorie: t(120), niche: t(200),
  telephone: t(50), whatsapp: t(50), email: t(200).transform((v) => (isEmail(v) ? v.toLowerCase() : "")),
  site_web: httpUrl, facebook: soc("facebook"), instagram: soc("instagram"),
  tiktok: t(300).transform((v) => (/^https:\/\/(www\.)?tiktok\.com\/@[\w.]+$/i.test(v) ? v : "")),
  adresse: t(300), colonia: t(200), ville: t(200), horaires: t(300),
  lat: z.number().min(14).max(33).nullable().default(null), lng: z.number().min(-119).max(-86).nullable().default(null),
});
export type CandidateInput = z.infer<typeof CandidateSchema>;
