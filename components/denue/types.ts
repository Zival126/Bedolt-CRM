// Types partagés de l'interface DENUE (côté navigateur).
export type Existing = { id: number; statut: string; reason: "id" | "tel" | "nom"; dnc: boolean } | null;
export type Row = {
  clee: string; id: string; nom: string; raison: string; activite: string; classe: string; estrato: string; strate: number; tipo: string;
  adresse: string; colonia: string; cp: string; ubicacion: string; ent?: string; estado?: string; mun: string; municipio: string; ville: string;
  telephone: string; email: string; site_web: string; lat: number | null; lng: number | null; alta: string; existing: Existing;
};
export type Code = { code: string; title: string };
export type NicheP = { label: string; codes: string[]; titles: string[] };
/** place : libellé de la zone (« Monterrey (Nuevo León) »), enregistré avec la recherche. */
export type Params =
  | { mode: "zone"; entidad: string; municipio: string; localidad: string; codes: string[]; estrato: string; nombre: string; place?: string }
  | { mode: "point"; lat: number; lng: number; rayon: number; condition: string; codes: string[]; place?: string }
  | { mode: "nom"; q: string; method: "nombre" | "entidad"; entidad: string; codes: string[]; place?: string };
export type Saved = { id: number; name: string; params: Params; watch: boolean; created_at: string; last_run_at: string | null; last_total: number | null; last_error: string; news: number };
export type Qual = { fiche_google: string; interet: string; note: string };

export const STRATES: [string, string][] = [["", "Toutes tailles"], ["1", "0 à 5 personnes"], ["2", "6 à 10"], ["3", "11 à 30"], ["4", "31 à 50"], ["5", "51 à 100"], ["6", "101 à 250"], ["7", "251 et plus"]];
export const REASON = { id: "même identifiant de source", tel: "même téléphone", nom: "nom proche à < 100 m" } as const;

/** Mois écoulés depuis une date d'alta « AAAA-MM ». */
export function monthsSince(alta: string, now = new Date()): number | null {
  const m = alta.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  return (now.getFullYear() - Number(m[1])) * 12 + (now.getMonth() + 1 - Number(m[2]));
}

/** Résumé lisible d'une recherche. */
export function describe(p: Params, codeTitle: (c: string) => string): string {
  const acts = p.codes.map((c) => codeTitle(c) || c).join(", ");
  if (p.mode === "zone") {
    return [acts, p.place || `entidad ${p.entidad}${p.municipio ? ` · municipio ${p.municipio}` : ""}${p.localidad ? ` · localidad ${p.localidad}` : ""}`,
      p.estrato ? `strate ${p.estrato}` : "", p.nombre ? `« ${p.nombre} »` : ""].filter(Boolean).join(" · ");
  }
  if (p.mode === "point") return [`${p.rayon} m autour de ${p.place || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}`, p.condition ? `« ${p.condition} »` : "", acts].filter(Boolean).join(" · ");
  return [`${p.method === "entidad" ? "mot-clé" : "nom"} « ${p.q} »`, p.place || (p.entidad === "00" ? "tout le Mexique" : `entidad ${p.entidad}`), acts].filter(Boolean).join(" · ");
}
