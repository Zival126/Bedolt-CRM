import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { geo, entidades, municipiosOf, municipio, searchZones, defaultFavoris, localidadesAll, setGeoFetch, inferZone, sameState, zoneLabel } from "@/lib/geo-mx";
import { setDenueFetch, areaPath, mapRow, nombre, cuantificar } from "@/lib/denue";
import { runSearch, addRows } from "@/lib/denue-run";
import { market, saveSearch, runSaved, savedSearches } from "@/lib/denue-watch";
import { saveNiches } from "@/lib/niches";
import { getBusiness, insertBusiness, idsForFilter } from "@/lib/crm";
import { readFilters } from "@/lib/filters";
import { locate } from "@/lib/geocode";
import { areaRow, TOKEN } from "./fixtures";

beforeEach(() => {
  setSetting("denue_token", TOKEN);
  db.exec("DELETE FROM denue_cache; DELETE FROM denue_seen; DELETE FROM denue_searches; DELETE FROM businesses; DELETE FROM geo_localidades; DELETE FROM geo_cache;");
  saveNiches([{ label: "Beauté & coiffure", codes: ["812110"] }]);
});

test("catalogue national : 32 entidades, tous les municipios, codes connus", () => {
  const g = geo();
  assert.equal(entidades().length, 32);
  assert.equal(g.munis.length, g.ents.reduce((a, e) => a + municipiosOf(e.c).length, 0));
  assert.ok(g.munis.length >= 2469, `municipios : ${g.munis.length}`);   // 2 469 au recensement 2020, plus les créations depuis
  assert.equal(municipio("23", "005")?.n, "Benito Juárez");
  assert.equal(municipio("19", "039")?.n, "Monterrey");
  assert.equal(municipio("14", "039")?.n, "Guadalajara");
  assert.equal(municipiosOf("20").length, 570);                          // Oaxaca
  assert.equal(entidades().find((e) => e.c === "09")?.n, "Ciudad de México");
  assert.ok(g.locs.length > 4000 && g.meta.totalLocs > 250_000);
  assert.ok(g.locs.every((l) => /^\d{2}$/.test(l.e) && /^\d{3}$/.test(l.m) && /^\d{4}$/.test(l.c)));
});

test("recherche de zone : accents / majuscules ignorés, synonymes", () => {
  const first = (q: string) => searchZones(q)[0];
  assert.deepEqual([first("cdmx").type, first("cdmx").ent], ["entidad", "09"]);
  assert.equal(first("DF").ent, "09");
  assert.deepEqual([first("edomex").type, first("edomex").ent], ["entidad", "15"]);
  const mty = searchZones("monterrey").slice(0, 2).map((h) => h.type + ":" + h.ent + h.mun);
  assert.ok(mty.includes("municipio:19039"), mty.join());
  assert.deepEqual([first("playa").label.split(" — ")[0], first("playa").ent], ["Playa del Carmen", "23"]);
  assert.equal(first("merida").ent + first("merida").mun, "31050");
  assert.ok(first("merida").label.startsWith("Mérida"));
  assert.equal(first("guadalajara").ent, "14");
  const cancun = searchZones("Cancún").slice(0, 2).map((h) => h.type + ":" + h.ent + h.mun + h.loc);
  assert.deepEqual(cancun.sort(), ["localidad:230050001", "municipio:23005"]);
  assert.equal(first("tulum").ent, "23");
  assert.equal(first("san luis potosi").ent, "24");
  assert.deepEqual(searchZones("x"), []);
  assert.equal(zoneLabel({ ent: "19", mun: "039" }), "Monterrey (Nuevo León)");
  assert.equal(zoneLabel({ ent: "00" }), "Tout le Mexique");
});

test("favoris par défaut : résolus par nom dans le catalogue (14)", () => {
  const f = defaultFavoris();
  assert.equal(f.length, 14);
  const by = Object.fromEntries(f.map((x) => [x.label, x.ent + x.mun + x.loc]));
  assert.equal(by.CDMX, "09");
  assert.equal(by.Monterrey, "19039");
  assert.equal(by.Guadalajara, "14039");
  assert.equal(by["Playa del Carmen"], "230080001");
  assert.equal(by["Puerto Morelos"], "23011");
});

test("localidades rurales à la demande : service INEGI puis cache ; repli sur le catalogue", async () => {
  let calls = 0;
  setGeoFetch(async (u) => { calls++; assert.equal(u, "https://gaia.inegi.org.mx/wscatgeo/v2/localidades/19039");
    return Response.json({ datos: [{ cve_ent: "19", cve_mun: "039", cve_loc: "0001", nomgeo: "Monterrey", ambito: "URBANO", latitud: "25.66", longitud: "-100.31", pob_total: "1142952" },
      { cve_ent: "19", cve_mun: "039", cve_loc: "0123", nomgeo: "Rancho Viejo", ambito: "RURAL", latitud: "25.7", longitud: "-100.4", pob_total: "12" }] }); });
  const a = await localidadesAll("19", "039");
  assert.deepEqual([a.source, a.list.length, a.list[1].n], ["inegi", 2, "Rancho Viejo"]);
  const b = await localidadesAll("19", "039");
  assert.deepEqual([b.source, calls], ["cache", 1]);
  setGeoFetch(async () => { throw new Error("réseau"); });
  const c = await localidadesAll("14", "039");
  assert.equal(c.source, "catalogue");
  assert.ok(c.list.some((l) => l.n === "Guadalajara"));
  assert.deepEqual((await localidadesAll("99", "999")).list, []);
  setGeoFetch(null);
});

/** Faux DENUE : n établissements par État (CLEE et AreaGeo de l'État demandé). */
function fakeDenue(per: Record<string, number>) {
  const calls: string[] = [];
  setDenueFetch((async (url: string) => {
    const path = url.match(/\/consulta\/(.+)\/[^/]+$/)![1];
    calls.push(path);
    const p = path.split("/");
    if (p[0] === "Cuantificar") return Response.json(p[1].split(",").flatMap((ae) => p[2].split(",").map((ag) => ({ AE: ae, AG: ag, Total: String(per[ag] ?? per[ag.slice(0, 2)] ?? 0) }))));
    const ent = p[0] === "BuscarAreaActEstr" ? p[1] : p[2];
    const mun = p[0] === "BuscarAreaActEstr" ? (p[2] === "0" ? "039" : p[2]) : "039";
    const n = per[ent] ?? 0, ini = Number(p[0] === "BuscarAreaActEstr" ? p[11] : p[3]);
    const rows = [];
    for (let i = ini; i <= Math.min(n, ini + 499); i++) {
      const r = areaRow(i, { AreaGeo: `${ent}${mun}0001`, Ubicacion: "X, Y, Z" });
      rows.push({ ...r, CLEE: `${ent}${mun}${r.CLEE.slice(5)}` });
    }
    return Response.json(rows);
  }) as never);
  return calls;
}

test("DENUE dans 3 États : URL, résultats, ville / État / municipio, ajout au CRM", async () => {
  const calls = fakeDenue({ "19": 7, "14": 3, "09": 2, "19039": 7 });
  assert.equal(areaPath({ entidad: "19", municipio: "039", code: "812110" }, 1, 500), "BuscarAreaActEstr/19/039/0/0/0/0/0/0/812110/0/1/500/0/0");
  assert.equal(areaPath({ entidad: "09", code: "8121" }, 1, 500), "BuscarAreaActEstr/09/0/0/0/0/0/0/8121/0/0/1/500/0/0");
  const r = await runSearch({ mode: "zone", entidad: "19", municipio: "039", localidad: "", codes: ["812110"], estrato: "", nombre: "" });
  assert.equal(r.rows.length, 7);
  assert.ok(calls.includes("Cuantificar/812110/19039/0"));
  const row = r.rows[0];
  assert.deepEqual([row.ent, row.estado, row.mun, row.municipio, row.ville], ["19", "Nuevo León", "039", "Monterrey", "Monterrey"]);
  assert.equal((await runSearch({ mode: "zone", entidad: "14", municipio: "", localidad: "", codes: ["812110"], estrato: "", nombre: "" })).rows.length, 3);
  await nombre("salon", 1, 500, "09");
  await nombre("salon", 1, 500, "00");
  assert.ok(calls.includes("Nombre/salon/09/1/500") && calls.includes("Nombre/salon/00/1/500"));
  // Ajout : État et municipio remplis depuis la réponse DENUE et le catalogue
  const add = addRows([{ ...row, fiche_google: "", interet: "", note: "" }]);
  const b = getBusiness(Object.values(add.ids)[0])!;
  assert.deepEqual([b.etat_code, b.etat, b.municipio_code, b.municipio, b.ville], ["19", "Nuevo León", "039", "Monterrey", "Monterrey"]);
  // Filtre État (Commerces / Carte)
  insertBusiness({ nom: "Salon Cancún", ville: "Cancún" });
  assert.deepEqual(idsForFilter(readFilters({ vue: "toutes", etat: "19" }).f), [b.id]);
  assert.equal(idsForFilter(readFilters({ vue: "toutes", etat: "23" }).f).length, 1);
});

test("Marché d'un autre État et « par État » : une requête Cuantificar, fiches du CRM regroupées", async () => {
  const calls = fakeDenue({ "19039": 40, "19026": 12, "19": 300, "23": 90, "14": 120 });
  insertBusiness({ nom: "Uñas Mty", niche: "Beauté & coiffure", ville: "Monterrey", lat: 25.67, lng: -100.31 });
  const m = await market("0", "19", "municipio");
  assert.equal(m.municipios.length, 51);
  assert.equal(m.truncated, 0);
  assert.equal(calls.filter((c) => c.startsWith("Cuantificar")).length, 1);
  assert.deepEqual(m.cells["Beauté & coiffure|039"], { denue: 40, crm: 1, contactes: 0, clients: 0 });
  assert.equal(m.cells["Beauté & coiffure|026"].denue, 12);
  const e = await market("0", "23", "etat");
  assert.equal(e.municipios.length, 32);
  assert.deepEqual([e.cells["Beauté & coiffure|19"].denue, e.cells["Beauté & coiffure|19"].crm], [300, 1]);
  const oax = await market("0", "20", "municipio");
  assert.deepEqual([oax.municipios.length, oax.truncated], [60, 510]);
  assert.equal(new Set((await cuantificar(["812110"], ["0"])).map((x) => x.ag)).size, 1);   // 0 = tout le pays
});

test("recherche enregistrée et veille hors Quintana Roo", async () => {
  const calls = fakeDenue({ "14": 4 });
  const id = saveSearch({ name: "Beauté Guadalajara", params: { mode: "zone", entidad: "14", municipio: "039", localidad: "", codes: ["812110"], estrato: "", nombre: "", place: "Guadalajara (Jalisco)" }, watch: true });
  const s = savedSearches().find((x) => x.id === id)!;
  assert.equal(s.params.mode === "zone" && s.params.entidad, "14");
  assert.equal(s.params.place, "Guadalajara (Jalisco)");
  assert.equal((await runSaved(id)).total, 4);
  assert.ok(calls.some((c) => c.startsWith("BuscarAreaActEstr/14/039/")));
  // Ancienne recherche (sans entidad) : Quintana Roo, libellé reconstitué
  db.prepare("INSERT INTO denue_searches(name, params, watch, created_at) VALUES('ancienne', ?, 0, '2026-11-01')").run(JSON.stringify({ mode: "zone", municipio: "005", localidad: "", codes: ["812110"], estrato: "", nombre: "" }));
  const old = savedSearches().find((x) => x.name === "ancienne")!;
  assert.deepEqual([old.params.mode === "zone" && old.params.entidad, old.params.place], ["23", "Benito Juárez (Quintana Roo)"]);
});

test("zone d'une fiche : position, ville, CLEE ; colonnes remplies à la création", () => {
  assert.deepEqual(inferZone({ lat: 25.6866, lng: -100.3161 }), { ent: "19", mun: "039" });
  assert.deepEqual(inferZone({ ville: "Tulum" }), { ent: "23", mun: "009" });
  assert.deepEqual(inferZone({ ville: "Playa del Carmen" }), { ent: "23", mun: "008" });
  assert.deepEqual(inferZone({ ville: "Guadalajara" }), { ent: "14", mun: "039" });
  assert.equal(inferZone({ ville: "Inexistante" }), null);
  const id = insertBusiness({ nom: "Spa Mérida", ville: "Mérida" });
  assert.deepEqual([getBusiness(id)!.etat, getBusiness(id)!.municipio], ["Yucatán", "Mérida"]);
  assert.ok(sameState("Coahuila de Zaragoza", "Coahuila"));
  assert.ok(sameState("México", "Estado de México"));
  assert.ok(!sameState("México", "Ciudad de México"));
  assert.ok(sameState("Nuevo León", "Nuevo Leon"));
});

test("géocodage hors Quintana Roo : résultat gardé seulement dans l'État de la fiche", async () => {
  process.env.NOMINATIM_URL = "https://nominatim.example.test";
  process.env.GEOCODER_INTERVAL_MS = "0";
  const urls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (u: string) => {
    urls.push(decodeURIComponent(String(u).replace(/\+/g, " ")));
    return Response.json([
      { lat: "25.4232", lon: "-101.0053", place_rank: 30, category: "shop", type: "beauty", name: "Uñas Luna", address: { state: "Coahuila", country_code: "mx" } },
      { lat: "25.6800", lon: "-100.3100", place_rank: 30, category: "shop", type: "beauty", name: "Uñas Luna", address: { state: "Nuevo León", country_code: "mx" } },
      { lat: "29.4", lon: "-98.5", place_rank: 30, category: "shop", type: "beauty", name: "Uñas Luna", address: { state: "Texas", country_code: "us" } },
    ]);
  }) as typeof fetch;
  try {
    const r = await locate({ id: 1, nom: "Uñas Luna", adresse: "", colonia: "", ville: "Monterrey", zone: "", lien_google: "", lat: null, geo_source: "", etat: "Nuevo León" });
    assert.deepEqual([r?.lat, r?.lng, r?.precision], [25.68, -100.31, "commerce"]);
    assert.ok(urls[0].includes("q=Uñas Luna, Monterrey, Nuevo León") && !urls[0].includes("viewbox"));
    const none = await locate({ id: 2, nom: "Uñas Luna", adresse: "", colonia: "", ville: "Monterrey", zone: "", lien_google: "", lat: null, geo_source: "", etat: "Jalisco" });
    assert.equal(none, null);                                 // aucun candidat au Jalisco
  } finally { globalThis.fetch = orig; delete process.env.NOMINATIM_URL; delete process.env.GEOCODER_INTERVAL_MS; }
});
