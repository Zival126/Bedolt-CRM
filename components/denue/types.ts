// Types partagés de l'interface DENUE (côté navigateur).
export type Existing = { id: number; statut: string; reason: "clee" | "tel" | "nom"; dnc: boolean } | null;
export type Row = {
  clee: string; id: string; nom: string; raison: string; activite: string; classe: string; estrato: string; strate: number; tipo: string;
  adresse: string; colonia: string; cp: string; ubicacion: string; mun: string; municipio: string; ville: string;
  telephone: string; email: string; site_web: string; lat: number | null; lng: number | null; alta: string; existing: Existing;
};
export type Code = { code: string; title: string };
export type Muni = { code: string; nom: string; seat: string };
export type Loc = { m: string; c: string; n: string; p: number };
export type NicheP = { label: string; codes: string[]; titles: string[] };
export type Params =
  | { mode: "zone"; municipio: string; localidad: string; codes: string[]; estrato: string; nombre: string }
  | { mode: "point"; lat: number; lng: number; rayon: number; condition: string; codes: string[] }
  | { mode: "nom"; q: string; method: "nombre" | "entidad"; codes: string[] };
export type Saved = { id: number; name: string; params: Params; watch: boolean; created_at: string; last_run_at: string | null; last_total: number | null; last_error: string; news: number };
export type Qual = { fiche_google: string; interet: string; note: string };

export const STRATES: [string, string][] = [["", "Toutes tailles"], ["1", "0 à 5 personnes"], ["2", "6 à 10"], ["3", "11 à 30"], ["4", "31 à 50"], ["5", "51 à 100"], ["6", "101 à 250"], ["7", "251 et plus"]];
export const REASON = { clee: "même CLEE", tel: "même téléphone", nom: "même nom à < 100 m" } as const;

/** Mois écoulés depuis une date d'alta « AAAA-MM ». */
export function monthsSince(alta: string, now = new Date()): number | null {
  const m = alta.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  return (now.getFullYear() - Number(m[1])) * 12 + (now.getMonth() + 1 - Number(m[2]));
}

/** Résumé lisible d'une recherche. */
export function describe(p: Params, munis: Muni[], codeTitle: (c: string) => string): string {
  const acts = p.codes.map((c) => codeTitle(c) || c).join(", ");
  if (p.mode === "zone") {
    const m = munis.find((x) => x.code === p.municipio);
    return [acts, m ? m.nom : "tout Quintana Roo", p.localidad ? `localidad ${p.localidad}` : "", p.estrato ? `strate ${p.estrato}` : "", p.nombre ? `« ${p.nombre} »` : ""].filter(Boolean).join(" · ");
  }
  if (p.mode === "point") return [`${p.rayon} m autour de ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`, p.condition ? `« ${p.condition} »` : "", acts].filter(Boolean).join(" · ");
  return [`${p.method === "entidad" ? "mot-clé" : "nom"} « ${p.q} »`, acts].filter(Boolean).join(" · ");
}
