import { NextResponse } from "next/server";
import { entidades, municipiosOf, localidadesAll, entidad, municipio } from "@/lib/geo-mx";
import { route } from "@/lib/api";
import { requireSession } from "@/lib/session";

// Sélection en 3 niveaux : sans paramètre → États ; ?ent= → municipios ; ?ent=&mun= → localidades (rurales comprises,
// service INEGI à la demande, cache 30 jours).
export const GET = route(async (req) => {
  await requireSession();
  const sp = new URL(req.url).searchParams;
  const ent = sp.get("ent") ?? "", mun = sp.get("mun") ?? "";
  if (!ent) return NextResponse.json({ entidades: entidades().map((e) => ({ code: e.c, nom: e.n })) });
  if (!/^\d{2}$/.test(ent) || !entidad(ent)) return NextResponse.json({ error: "État inconnu." }, { status: 400 });
  if (!mun) return NextResponse.json({ municipios: municipiosOf(ent).map((m) => ({ code: m.m, nom: m.n, p: m.p })).sort((a, b) => a.nom.localeCompare(b.nom, "es")) });
  if (!/^\d{3}$/.test(mun) || !municipio(ent, mun)) return NextResponse.json({ error: "Municipio inconnu." }, { status: 400 });
  const r = await localidadesAll(ent, mun);
  return NextResponse.json({ localidades: r.list.map((l) => ({ code: l.c, nom: l.n, p: l.p, u: l.u, lat: l.lat, lng: l.lng })), source: r.source });
});
