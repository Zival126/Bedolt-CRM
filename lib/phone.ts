/** Garde les 10 derniers chiffres d'un numéro mexicain (clé de dédoublonnage). '' si invalide. */
export function telNorm(raw: string | null | undefined): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length >= 12 && d.startsWith("52")) d = d.slice(-10); // 52 + 10 chiffres (ou 521 + 10)
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : "";
}

/** Numéro pour wa.me : 52 + 10 chiffres. '' si invalide. */
export function waNumber(raw: string | null | undefined): string {
  const n = telNorm(raw);
  return n ? "52" + n : "";
}

/** Affichage : +52 998 123 4567 */
export function prettyPhone(raw: string | null | undefined): string {
  const n = telNorm(raw);
  return n ? `+52 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : String(raw ?? "");
}

/** URL http(s) valide, sinon '' (jamais de javascript: ni data: dans un href). */
export function safeHttpUrl(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

export const mapsSearchUrl = (nom: string, ville: string) =>
  "https://www.google.com/maps/search/" + encodeURIComponent(`${nom} ${ville}`.trim());
export const mapsPlaceUrl = (b: { lien_google?: string; lat?: number | null; lng?: number | null; nom: string; adresse?: string; ville?: string }) =>
  safeHttpUrl(b.lien_google) || (b.lat != null && b.lng != null
    ? `https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`
    : mapsSearchUrl(b.nom, `${b.adresse ?? ""} ${b.ville ?? ""}`));
