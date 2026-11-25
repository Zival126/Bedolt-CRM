import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { getBusiness } from "@/lib/crm";
import { addCandidates, existingIndex } from "@/lib/sources";
import { apiSearch, apiDetails, apiUsage, saveApiSettings, setPlacesFetch, forStorage, toCandidate, apiEnabled, ApiError, type ApiKey } from "@/lib/places-api";

// Réponses simulées au format documenté de chaque API (champs utilisés seulement).
const FSQ = { results: [{ fsq_place_id: "5a1b2c3d4e5f60718293a4b5", name: "Clínica Dental Sonrisa", latitude: 21.16, longitude: -86.85,
  categories: [{ name: "Dentist's Office" }], location: { address: "Av. Tulum 10", locality: "Cancún" }, tel: "998 123 4567", website: "sonrisa.mx" }] };
const HERE = { items: [{ id: "here:pds:place:484d4bd2-1111-2222-3333-444455556666", title: "Barbería Don Pepe", position: { lat: 21.17, lng: -86.84 },
  address: { label: "Calle 5, Cancún", street: "Calle 5", houseNumber: "12", city: "Cancún", district: "SM 22" }, categories: [{ name: "Peluquería", primary: true }],
  contacts: [{ phone: [{ value: "+529981112233" }], www: [{ value: "https://donpepe.mx" }] }] }] };
const TOMTOM = { results: [{ id: "g6JpZK8xMjQwMDkzMjcyNDA2NDGhY6NNRVg", poi: { name: "Taller Hermanos", phone: "+52 998 555 0001", categories: ["car repair"], url: "www.taller.mx" },
  address: { streetName: "Av. Kabah", municipality: "Cancún", freeformAddress: "Av. Kabah, Cancún" }, position: { lat: 21.15, lon: -86.86 } }] };
const GOOGLE = { places: [{ id: "ChIJAbCdEfGhIjKlMnOpQrStUv", displayName: { text: "Spa Coral" }, formattedAddress: "Blvd. Kukulcán km 9, Cancún", location: { latitude: 21.13, longitude: -86.75 },
  primaryTypeDisplayName: { text: "Spa" }, googleMapsUri: "https://maps.google.com/?cid=1" }] };

const KEYS: Record<ApiKey, string> = { foursquare: "FOURSQUARE_API_KEY", here: "HERE_API_KEY", tomtom: "TOMTOM_API_KEY", google: "GOOGLE_PLACES_KEY" };
let calls: { url: string; init: RequestInit }[] = [];
const fake = (cacheControl = "") => async (url: string, init: RequestInit) => {
  calls.push({ url, init });
  const h = { "Content-Type": "application/json", ...(cacheControl ? { "Cache-Control": cacheControl } : {}) };
  if (url.includes("foursquare")) return new Response(JSON.stringify(url.includes("/places/search") ? FSQ : FSQ.results[0]), { headers: h });
  if (url.includes("hereapi")) return new Response(JSON.stringify(url.includes("lookup") ? HERE.items[0] : HERE), { headers: h });
  if (url.includes("tomtom")) return new Response(JSON.stringify(TOMTOM), { headers: h });
  if (url.includes("googleapis")) return new Response(JSON.stringify(url.includes(":searchText") ? GOOGLE : GOOGLE.places[0]), { headers: h });
  return new Response("", { status: 404 });
};
const Q = { lat: 21.16, lng: -86.85, radius: 3000, term: "dentista", limit: 50 };

beforeEach(() => {
  db.exec("DELETE FROM businesses; DELETE FROM api_usage; DELETE FROM http_cache; DELETE FROM settings WHERE key LIKE 'api_%';");
  for (const k of Object.values(KEYS)) delete process.env[k];
  calls = [];
  setPlacesFetch(fake());
});

test("sans clé : source désactivée, aucune requête", async () => {
  for (const p of ["foursquare", "here", "tomtom", "google"] as ApiKey[]) {
    assert.equal(apiEnabled(p), false);
    await assert.rejects(apiSearch(p, Q), (e: Error) => e instanceof ApiError && e.code === "nokey" && /clé requise/.test(e.message));
  }
  assert.equal(calls.length, 0);
});

test("4 API : requêtes conformes à la doc, clé jamais dans la réponse, conversion en lieux", async () => {
  for (const k of Object.values(KEYS)) process.env[k] = "test-key-0123456789abcdef";
  const f = await apiSearch("foursquare", Q);
  assert.equal(f.places[0].nom, "Clínica Dental Sonrisa");
  assert.equal(f.places[0].site_web, "https://sonrisa.mx");
  assert.match(calls[0].url, /^https:\/\/places-api\.foursquare\.com\/places\/search\?ll=21\.16%2C-86\.85&radius=3000&limit=50&query=dentista$/);
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer test-key-0123456789abcdef");
  assert.ok((calls[0].init.headers as Record<string, string>)["X-Places-Api-Version"]);
  const h = await apiSearch("here", { ...Q, term: "barbería" });
  assert.deepEqual([h.places[0].telephone, h.places[0].colonia, h.places[0].adresse], ["+529981112233", "SM 22", "Calle 5 12"]);
  assert.match(calls[1].url, /^https:\/\/discover\.search\.hereapi\.com\/v1\/discover\?in=circle%3A21\.16%2C-86\.85%3Br%3D3000/);
  await apiSearch("here", { ...Q, term: "800-8000-0000" });                 // code de catégorie → Browse
  assert.match(calls[2].url, /^https:\/\/browse\.search\.hereapi\.com\/v1\/browse\?.*categories=800-8000-0000/);
  const t = await apiSearch("tomtom", { ...Q, term: "car repair" });
  assert.equal(t.places[0].ville, "Cancún");
  assert.match(calls[3].url, /^https:\/\/api\.tomtom\.com\/search\/2\/categorySearch\/car%20repair\.json\?key=/);
  const g = await apiSearch("google", { ...Q, term: "spa" });
  assert.equal(g.places[0].maps, "https://maps.google.com/?cid=1");
  const body = JSON.parse(String(calls[4].init.body));
  assert.equal(body.textQuery, "spa");
  assert.deepEqual(body.locationBias.circle.center, { latitude: 21.16, longitude: -86.85 });
  const mask = (calls[4].init.headers as Record<string, string>)["X-Goog-FieldMask"];
  assert.ok(!mask.includes("nationalPhoneNumber"), "champs Enterprise seulement sur option");
  saveApiSettings("google", { googleRich: true });
  await apiSearch("google", { ...Q, term: "spa 2" });
  assert.ok((calls[5].init.headers as Record<string, string>)["X-Goog-FieldMask"].includes("places.nationalPhoneNumber"));
  // Détails en direct
  assert.equal((await apiDetails("here", "here:pds:place:484d4bd2-1111-2222-3333-444455556666"))?.nom, "Barbería Don Pepe");
});

test("plafond mensuel : bloque AVANT l'appel, compteur du mois ; cache selon les conditions", async () => {
  process.env.HERE_API_KEY = process.env.GOOGLE_PLACES_KEY = process.env.TOMTOM_API_KEY = "test-key-0123456789abcdef";
  saveApiSettings("google", { cap: 2 });
  await apiSearch("google", Q); await apiSearch("google", { ...Q, term: "b" });
  assert.equal(apiUsage("google"), 2);
  const n = calls.length;
  await assert.rejects(apiSearch("google", { ...Q, term: "c" }), (e: Error) => e instanceof ApiError && e.code === "cap" && /Plafond mensuel Google Places atteint \(2 \/ 2/.test(e.message));
  assert.equal(calls.length, n);                                              // aucun appel au-delà du plafond
  // Google : jamais de cache (conditions) ; HERE : cache 24 h ; TomTom : seulement si Cache-Control l'autorise
  saveApiSettings("google", { cap: 100 });
  await apiSearch("google", Q);
  assert.equal(apiUsage("google"), 3);
  await apiSearch("here", Q); const r2 = await apiSearch("here", Q);
  assert.equal(r2.cached, true); assert.equal(apiUsage("here"), 1);
  await apiSearch("tomtom", Q); await apiSearch("tomtom", Q);
  assert.equal(apiUsage("tomtom"), 2);
  setPlacesFetch(fake("public, max-age=600"));
  await apiSearch("tomtom", { ...Q, term: "x" }); assert.equal((await apiSearch("tomtom", { ...Q, term: "x" })).cached, true);
  // Erreur HTTP lisible
  setPlacesFetch(async () => new Response("denied", { status: 403 }));
  await assert.rejects(apiSearch("here", { ...Q, term: "nouveau" }), /HERE refuse la clé \(403\)/);
});

test("stockage : identifiant + nom par défaut, complet sur option (catégorie → spécialité) ; aucune niche créée ; dédoublonnage", async () => {
  process.env.FOURSQUARE_API_KEY = "test-key-0123456789abcdef";
  const nichesBefore = (db.prepare("SELECT COUNT(*) n FROM niches").get() as { n: number }).n;
  const { places } = await apiSearch("foursquare", Q);
  const c = toCandidate("foursquare", places[0], "Dentistes");
  const r = addCandidates([forStorage(c, { ville: "Cancún", etat_code: "23", municipio_code: "005" })], "test");
  const b = getBusiness(r.ids[c.sourceId])!;
  assert.deepEqual([b.nom, b.foursquare_id, b.telephone, b.site_web, b.adresse, b.lat, b.ville, b.specialite, b.sources],
    ["Clínica Dental Sonrisa", "5a1b2c3d4e5f60718293a4b5", "", "", "", null, "Cancún", "", "foursquare"]);
  assert.ok(b.niche_id, "niche existante rattachée");
  assert.equal(existingIndex()(c)?.reason, "id");                             // déjà dans le CRM au prochain passage
  // Niche inconnue : jamais créée
  const u = addCandidates([forStorage({ ...toCandidate("foursquare", { ...places[0], id: "aaaaaaaaaaaaaaaaaaaaaaaa", nom: "Autre lieu" }, "Niche Inventée") }, { ville: "Cancún" })]);
  assert.equal(getBusiness(u.ids.aaaaaaaaaaaaaaaaaaaaaaaa)!.niche_id, null);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM niches").get() as { n: number }).n, nichesBefore);
  // Mode complet
  saveApiSettings("foursquare", { storage: "full" });
  const full = addCandidates([forStorage({ ...c, sourceId: "bbbbbbbbbbbbbbbbbbbbbbbb", telephone: "9981234567" }, { ville: "Cancún" })]);
  const f = getBusiness(full.ids.bbbbbbbbbbbbbbbbbbbbbbbb)!;
  assert.deepEqual([f.site_web, f.specialite, f.adresse, f.lat != null], ["https://sonrisa.mx", "Dentist's Office", "Av. Tulum 10", true]);
});
