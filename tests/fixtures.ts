// Réponses DENUE simulées, au format réel : clés et valeurs copiées des réponses publiées dans la documentation INEGI
// (https://www.inegi.org.mx/servicios/api_denue.html) et message d'erreur capturé par de vraies requêtes
// (HTTP 200, text/plain : « No autorizado. Utilice una clave válida. »).
export const UNAUTHORIZED = '"No autorizado. Utilice una clave válida."';
export const TOKEN = "11111111-2222-3333-4444-555555555555";

/** Établissement complet (méthodes BuscarAreaAct / BuscarAreaActEstr : 34 champs). */
export function areaRow(i: number, over: Record<string, string> = {}) {
  const clee = `23005812110${String(100000 + i).padStart(6, "0")}`;
  return {
    CLEE: clee, Id: String(9_000_000 + i), Nombre: `SALON DE BELLEZA NUM ${i}`, Razon_social: "",
    Clase_actividad: "Salones y clínicas de belleza y peluquerías", Estrato: "0 a 5 personas", Tipo_vialidad: "CALLE",
    Calle: "TULIPANES", Num_Exterior: String(i), Num_Interior: "", Colonia: "SUPERMANZANA 63", CP: "77513",
    Ubicacion: "CANCÚN, Benito Juárez, QUINTANA ROO", Telefono: i % 2 ? `998${String(1_000_000 + i).slice(-7)}` : "",
    Correo_e: i % 3 === 0 ? `SALON${i}@GMAIL.COM` : "", Sitio_internet: i % 5 === 0 ? `WWW.SALON${i}.COM` : "", Tipo: "Fijo",
    Longitud: (-86.85 - i * 0.001).toFixed(8), Latitud: (21.15 + i * 0.001).toFixed(8),
    tipo_corredor_industrial: "", nom_corredor_industrial: "", numero_local: "", AGEB: "401A", Manzana: "009",
    CLASE_ACTIVIDAD_ID: "812110", EDIFICIO_PISO: "", SECTOR_ACTIVIDAD_ID: "81", SUBSECTOR_ACTIVIDAD_ID: "812",
    RAMA_ACTIVIDAD_ID: "8121", SUBRAMA_ACTIVIDAD_ID: "81211", EDIFICACION: "", Tipo_Asentamiento: "COLONIA",
    Fecha_Alta: i % 4 === 0 ? "2026-03" : "2015-12", AreaGeo: "230050001", ...over,
  };
}

/** Établissement des méthodes Buscar / Nombre / Ficha (22 champs, sans Fecha_Alta ni CLASE_ACTIVIDAD_ID). */
export function shortRow(i: number, over: Record<string, string> = {}) {
  const r = areaRow(i, over) as Record<string, string>;
  const keep = ["CLEE", "Id", "Nombre", "Razon_social", "Clase_actividad", "Estrato", "Tipo_vialidad", "Calle", "Num_Exterior", "Num_Interior",
    "Colonia", "CP", "Ubicacion", "Telefono", "Correo_e", "Sitio_internet", "Tipo", "Longitud", "Latitud", "tipo_corredor_industrial", "nom_corredor_industrial", "numero_local"];
  return Object.fromEntries(keep.map((k) => [k, r[k]]));
}

export type Call = { path: string; token: string };
/**
 * Faux serveur INEGI : `total` établissements 812110 à Benito Juárez. Options : panne réseau / 503 sur certains appels
 * (numéros d'appel, à partir de 1), token refusé.
 */
export function fakeInegi(opts: { total?: number; failOn?: number[]; status503On?: number[]; badToken?: boolean; extra?: Record<string, unknown[]> } = {}) {
  const total = opts.total ?? 1234;
  const calls: Call[] = [];
  const fetcher = async (url: string): Promise<Response> => {
    const m = url.match(/\/consulta\/(.+)\/([^/]+)$/);
    if (!m) return new Response("", { status: 404 });
    const [, path, token] = m;
    calls.push({ path, token: decodeURIComponent(token) });
    const n = calls.length;
    if (opts.failOn?.includes(n)) throw new TypeError("fetch failed");
    if (opts.status503On?.includes(n)) return new Response("Service Unavailable", { status: 503 });
    if (opts.badToken) return new Response(UNAUTHORIZED, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    if (opts.extra?.[path]) return Response.json(opts.extra[path]);
    const p = path.split("/");
    const json = (d: unknown) => Response.json(d);
    switch (p[0]) {
      case "BuscarAreaActEstr": {
        if (p.length !== 15) return new Response("", { status: 404 });
        const [ini, fin] = [Number(p[11]), Number(p[12])];
        const matches = p[2] === "005" && (p[9] === "812110" || p[8] === "8121" || p[7] === "812");
        if (!matches) return json([]);
        const out = [];
        for (let i = ini; i <= Math.min(fin, total); i++) out.push(areaRow(i));
        return json(out);
      }
      case "Cuantificar": {
        const ae = p[1].split(","), ag = p[2].split(",");
        return json(ae.flatMap((a) => ag.map((g) => ({ AE: a, AG: g, Total: String(["812110", "8121"].includes(a) && ["23005", "23"].includes(g) ? total : 0) }))));
      }
      case "Buscar": return json([shortRow(1), shortRow(2), shortRow(3)]);
      case "Nombre": case "BuscarEntidad": {
        const [ini, fin] = [Number(p[3]), Number(p[4])];
        const out = [];
        for (let i = ini; i <= Math.min(fin, 620); i++) out.push(shortRow(i));
        return json(out);
      }
      case "Ficha": return json([shortRow(Number(p[1]) - 9_000_000, { Telefono: "9988776655", Correo_e: "NUEVO@SALON.MX" })]);
    }
    return new Response("", { status: 404 });
  };
  return { fetcher, calls };
}
