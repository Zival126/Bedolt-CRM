import { denueToken } from "./settings";

const BASE = "https://www.inegi.org.mx/app/api/denue/v1/consulta";

export type DenueRow = {
  clee: string; nom: string; raison: string; activite: string; estrato: string;
  adresse: string; colonia: string; cp: string; ubicacion: string; ville: string;
  telephone: string; email: string; site_web: string; lat: number | null; lng: number | null;
};

// Les champs renvoyés par l'API sont en PascalCase_Snake (CLEE, Nombre, Clase_actividad, Telefono…).
type Raw = Record<string, string>;
export function mapRow(r: Raw): DenueRow {
  const adr = [r.Tipo_vialidad, r.Calle, r.Num_Exterior && `#${r.Num_Exterior}`, r.Num_Interior && `Int. ${r.Num_Interior}`].filter(Boolean).join(" ");
  // Ubicacion = « Colonia, MUNICIPIO, ESTADO »
  const parts = (r.Ubicacion ?? "").split(",").map((x) => x.trim());
  const num = (v?: string) => (v && !isNaN(Number(v)) ? Number(v) : null);
  return {
    clee: r.CLEE ?? r.Id ?? "", nom: r.Nombre ?? "", raison: r.Razon_social ?? "", activite: r.Clase_actividad ?? "",
    estrato: r.Estrato ?? "", adresse: adr, colonia: r.Colonia ?? parts[0] ?? "", cp: r.CP ?? "", ubicacion: r.Ubicacion ?? "",
    ville: parts.length >= 2 ? parts[parts.length - 2] : "", telephone: r.Telefono ?? "", email: r.Correo_e ?? "",
    site_web: r.Sitio_internet ?? "", lat: num(r.Latitud), lng: num(r.Longitud),
  };
}

async function call(path: string): Promise<DenueRow[]> {
  const token = denueToken();
  if (!token) throw new Error("Token DENUE manquant (Réglages > DENUE).");
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}/${token}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(25_000) });
  } catch {
    throw new Error("API INEGI injoignable (réseau, DNS ou délai dépassé).");
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`DENUE a répondu ${res.status}. ${text.slice(0, 160)}`);
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error("Réponse DENUE illisible : " + text.slice(0, 160)); }
  if (!Array.isArray(data)) throw new Error("Réponse DENUE inattendue : " + text.slice(0, 160));
  return (data as Raw[]).map(mapRow);
}

const seg = (v: string | number | undefined) => encodeURIComponent(String(v ?? "").trim() || "0");

/** Un code SCIAN de 2 à 6 chiffres est placé au bon niveau (secteur, sous-secteur, branche, classe). */
function scianSegments(code: string) {
  const c = code.replace(/\D/g, "");
  const out = { sector: "0", subsector: "0", rama: "0", clase: "0" };
  if (c.length === 2) out.sector = c;
  else if (c.length === 3) out.subsector = c;
  else if (c.length === 4) out.rama = c;
  else if (c.length === 6) out.clase = c;
  else if (c.length) throw new Error("Code SCIAN invalide (2, 3, 4 ou 6 chiffres).");
  return out;
}

export type Search =
  | { mode: "zone"; entidad: string; municipio: string; scian: string; strate: string; page: number; size: number }
  | { mode: "nom"; nom: string; entidad: string; page: number; size: number }
  | { mode: "point"; lat: number; lng: number; rayon: number; condition: string };

export async function denueSearch(s: Search): Promise<DenueRow[]> {
  if (s.mode === "zone") {
    const a = scianSegments(s.scian);
    const ini = (s.page - 1) * s.size + 1;
    // Format confirmé par la doc INEGI (exemple : BuscarAreaActEstr/01/0/0/0/0/0/0/0/0/oxxo/1/15/0/1) :
    // entidad/municipio/localidad/ageb/manzana/sector/subsector/rama/clase/nombre/reg_inicial/reg_final/0/estrato
    // (le « 0 » avant l'estrato est un paramètre obligatoire de la méthode)
    return call(`BuscarAreaActEstr/${seg(s.entidad)}/${seg(s.municipio)}/0/0/0/${a.sector}/${a.subsector}/${a.rama}/${a.clase}/0/${ini}/${ini + s.size - 1}/0/${seg(s.strate)}`);
  }
  if (s.mode === "nom") {
    const ini = (s.page - 1) * s.size + 1;
    return call(`Nombre/${encodeURIComponent(s.nom.trim())}/${seg(s.entidad)}/${ini}/${ini + s.size - 1}`);
  }
  const rayon = Math.min(Math.max(Math.round(s.rayon), 1), 5000);
  return call(`Buscar/${encodeURIComponent(s.condition.trim() || "todos")}/${s.lat},${s.lng}/${rayon}`);
}

export async function denueTest(): Promise<{ ok: boolean; message: string }> {
  try {
    await denueSearch({ mode: "nom", nom: "farmacia", entidad: "23", page: 1, size: 1 });
    return { ok: true, message: "Connexion DENUE OK." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
