import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/db";
import { insertBusiness, getBusiness, setDnc, setStatus } from "@/lib/crm";
import { addCandidates, existingIndex, originsOf, similarNames, type Candidate } from "@/lib/sources";
import { saveNiches, allNiches, setNicheMaps } from "@/lib/niches";
import { migrateV8 } from "@/lib/niche-seed";
import { nicheResolver, osmPresets } from "@/lib/category-map";
import { buildQuery, toCandidates, overpass, setOsmFetch, checkBbox, searchOsm, osmInstances, saveOsmInstances, type OsmElement, type OsmEvent } from "@/lib/osm";
import { searchOverture, overtureMeta } from "@/lib/overture";
import { extract, contactPages, robotsAllows, enrichBusiness, setEnrichDeps, enqueueEnrich, enrichStatus, tick, usefulEmail } from "@/lib/enrich";
import { vetUrl, safeGet, httpTransport, publicIpRefusal, FetchBlocked, type Transport } from "@/lib/safe-fetch";
import { checkOnGoogle, setGoogleFetch, googleUsage } from "@/lib/google";
import { sourceStats } from "@/lib/source-stats";

const NICHES = [{ label: "Beauté & coiffure", codes: ["812110"] }, { label: "Dentistes", codes: ["621211"] }, { label: "Restaurants & cafés", codes: ["722511"] }, { label: "Bars", codes: ["722412"] }];
beforeEach(() => {
  db.exec("DELETE FROM businesses; DELETE FROM http_cache; DELETE FROM category_map; DELETE FROM enrich_queue; DELETE FROM field_origins; DELETE FROM overture_places; DELETE FROM google_usage; DELETE FROM niche_maps; DELETE FROM niches;");
  migrateV8(db);
  saveNiches(NICHES);
});

const cand = (o: Partial<Candidate> = {}): Candidate => ({
  source: "osm", sourceId: "node/1", nom: "Salón Luna", categorie: "shop=beauty", niche: "Beauté & coiffure", telephone: "", email: "", site_web: "",
  facebook: "", instagram: "", adresse: "", colonia: "", ville: "Cancún", lat: 21.16, lng: -86.85, ...o,
});

// ---------- Dédoublonnage inter-sources et fusion ----------
test("fusion inter-sources : identifiant, téléphone, nom proche < 100 m ; champs vides seulement ; sources listées", () => {
  const a = insertBusiness({ nom: "Salon Luna Nails", telephone: "998 100 0001", email: "", source: "DENUE", denue_id: "23005812110100001", lat: 21.1601, lng: -86.8501 });
  const b = insertBusiness({ nom: "Barbería Don José", telephone: "", email: "jose@barberia.mx", source: "Excel", ville: "Cancún" });
  const c = insertBusiness({ nom: "Dental Sonrisa", source: "manuel", lat: 21.17, lng: -86.83 });
  setStatus(a, "interesse"); setDnc([a], true);
  const r = addCandidates([
    cand({ sourceId: "node/10", telephone: "+52 998 100 0001", email: "hola@luna.mx", instagram: "https://www.instagram.com/luna" }),    // même téléphone
    cand({ sourceId: "node/11", nom: "Barberia Don Jose", telephone: "9982223333", email: "otro@x.mx", lat: null, lng: null }),         // nouveau (pas de position, autre tél.)
    cand({ source: "overture", sourceId: "ov-abc-123", nom: "DENTAL SONRISA", lat: 21.1703, lng: -86.8301, site_web: "https://sonrisa.mx" }), // nom proche à ~33 m
    cand({ source: "overture", sourceId: "ov-abc-123", nom: "Dental Sonrisa" }),                                                          // doublon dans la sélection
  ], "test");
  assert.deepEqual([r.added, r.merged], [1, 3]);
  const A = getBusiness(a)!;
  assert.equal(A.email, "hola@luna.mx");
  assert.equal(A.instagram, "https://www.instagram.com/luna");
  assert.equal(A.sources, "denue,osm");
  assert.equal(A.osm_id, "node/10");
  assert.equal(A.statut, "interesse");                    // statut jamais modifié
  assert.equal(A.ne_pas_contacter, 1);                    // « ne pas contacter » jamais retiré
  assert.ok(originsOf(a).some((o) => o.field === "email" && /OpenStreetMap/.test(o.origin)));
  assert.equal(getBusiness(b)!.email, "jose@barberia.mx");  // pas fusionnée (autre téléphone, pas de position) : intacte
  const C = getBusiness(c)!;
  assert.equal(C.site_web, "https://sonrisa.mx");
  assert.equal(C.sources, "manuel,overture");
  assert.equal(C.overture_id, "ov-abc-123");
  // Nouvelle fiche : source osm, niche, liste des sources
  const n = getBusiness(r.ids["node/11"])!;
  assert.deepEqual([n.source, n.sources, n.niche, n.statut], ["OSM", "osm", "Beauté & coiffure", "a_contacter"]);
  // Ajouter deux fois = fusion, jamais de doublon
  const again = addCandidates([cand({ sourceId: "node/11", nom: "Barberia Don Jose", telephone: "9982223333", lat: null, lng: null })]);
  assert.deepEqual([again.added, again.merged], [0, 1]);
  assert.equal(existingIndex()(cand({ sourceId: "node/11", telephone: "", lat: null, lng: null }))?.reason, "id");
});

test("noms proches", () => {
  assert.ok(similarNames("Salón Luna", "SALON LUNA"));
  assert.ok(similarNames("Luna Nails", "Salon Luna Nails Cancún"));
  assert.ok(!similarNames("Luna", "Salon Luna Nails"));          // trop court pour l'inclusion
  assert.ok(!similarNames("Spa Maya", "Dental Maya"));
});

// ---------- Correspondance des niches ----------
test("catégories OSM / Overture → Mes niches, surcharges éditables", () => {
  const osm = nicheResolver("osm"), ov = nicheResolver("overture");
  assert.equal(osm(["shop=hairdresser"]), "Beauté & coiffure");
  assert.equal(osm(["amenity=dentist"]), "Dentistes");
  assert.equal(ov(["nail_salon"]), "Beauté & coiffure");
  assert.equal(ov(["general_dentistry"]), "Dentistes");
  assert.equal(ov(["smoothie_juice_bar"]), "Restaurants & cafés");
  assert.equal(ov(["cocktail_bar"]), "Bars");
  assert.equal(ov(["notary_public"]), "");
  assert.equal(osm(["leisure=fitness_centre"]), "");                 // « Salles de sport » absente de Mes niches
  const N = (l: string) => allNiches().find((n) => n.label === l)!;
  setNicheMaps(N("Dentistes").id, "osm", [...N("Dentistes").osm, "shop=beauty"]);
  setNicheMaps(N("Beauté & coiffure").id, "osm", N("Beauté & coiffure").osm.filter((t) => t !== "shop=beauty"));
  setNicheMaps(N("Beauté & coiffure").id, "overture", [...N("Beauté & coiffure").overture, "!nail_salon"]);   // exclusion
  assert.equal(nicheResolver("osm")(["shop=beauty"]), "Dentistes");
  assert.equal(nicheResolver("overture")(["nail_salon"]), "");
  assert.equal(nicheResolver("overture")(["hair_salon"]), "Beauté & coiffure");
  assert.ok(osmPresets().find((p) => p.niche === "Dentistes")!.tags.includes("shop=beauty"));
});

// ---------- OpenStreetMap / Overpass ----------
// Format JSON documenté d'Overpass (out center tags) : nœuds avec lat/lon, chemins / relations avec center.
const ELEMENTS: OsmElement[] = [
  { type: "node", id: 101, lat: 21.1612, lon: -86.8255, tags: { name: "Uñas Mía", shop: "beauty", beauty: "nails", phone: "+52 998 111 2233", "contact:instagram": "unasmia", website: "unasmia.mx", "addr:street": "Avenida Tulum", "addr:housenumber": "12", "addr:suburb": "SUPERMANZANA 22", "addr:city": "Cancún", opening_hours: "Mo-Sa 10:00-20:00" } },
  { type: "way", id: 202, center: { lat: 21.14, lon: -86.84 }, tags: { name: "Clínica Dental Riviera", amenity: "dentist", "contact:phone": "998 222 3344", "contact:email": "Citas@Riviera.MX", "contact:facebook": "https://www.facebook.com/dentalriviera" } },
  { type: "node", id: 303, lat: 21.15, lon: -86.83, tags: { shop: "hairdresser" } },                  // sans nom : ignoré
];
test("Overpass : requête, conversion, User-Agent, cache 24 h, reprise sur 429 / 504", async () => {
  const q = buildQuery(["shop=beauty", "amenity=dentist", "bad tag"], { s: 21.1, w: -86.9, n: 21.2, e: -86.8 });
  assert.equal(q, '[out:json][timeout:25];(nwr["shop"="beauty"](21.1,-86.9,21.2,-86.8);nwr["amenity"="dentist"](21.1,-86.9,21.2,-86.8););out center tags 3000;');
  assert.throws(() => checkBbox({ s: 17.8, w: -89.5, n: 21.7, e: -86.6 }), /trop grande/);
  const c = toCandidates(ELEMENTS);
  assert.equal(c.length, 2);
  assert.deepEqual({ ...c[0] }, { source: "osm", sourceId: "node/101", nom: "Uñas Mía", categorie: "shop=beauty", niche: "Beauté & coiffure",
    telephone: "+52 998 111 2233", whatsapp: "", email: "", site_web: "https://unasmia.mx", facebook: "", instagram: "https://www.instagram.com/unasmia", tiktok: "",
    adresse: "Avenida Tulum 12", colonia: "Supermanzana 22", ville: "Cancún", lat: 21.1612, lng: -86.8255, horaires: "Mo-Sa 10:00-20:00" });
  assert.deepEqual([c[1].sourceId, c[1].email, c[1].lat, c[1].niche], ["way/202", "citas@riviera.mx", 21.14, "Dentistes"]);

  const calls: { ua: string; body: string; url: string }[] = [];
  const waits: number[] = [];
  let n = 0;
  setOsmFetch(async (u, init) => {
    calls.push({ ua: String((init.headers as Record<string, string>)["User-Agent"]), body: String(init.body), url: u });
    n++;
    if (n === 1) return new Response("rate limited", { status: 429, headers: { "Retry-After": "7" } });
    if (n === 2) return new Response("<html>Gateway Timeout</html>", { status: 504 });
    return Response.json({ version: 0.6, generator: "Overpass API", osm3s: { timestamp_osm_base: "2026-11-23T20:00:00Z" }, elements: ELEMENTS });
  }, async (ms) => { waits.push(ms); });
  const r = await searchOsm(["shop=beauty"], { s: 21.1, w: -86.9, n: 21.2, e: -86.8 });
  assert.equal(r.candidates.length, 2);
  assert.equal(r.base, "2026-11-23T20:00:00Z");
  assert.deepEqual(waits, [7000, 10000]);                       // Retry-After respecté, puis attente croissante
  assert.deepEqual(calls.map((x) => new URL(x.url).hostname), ["overpass-api.de", "overpass.private.coffee", "maps.mail.ru"]);   // bascule de serveur
  assert.ok(calls.every((x) => /BedoltCRM\/1\.0 \(contacto@bedolt\.com\)/.test(x.ua)));
  assert.match(calls[0].body, /^data=%5Bout%3Ajson%5D/);
  const again = await searchOsm(["shop=beauty"], { s: 21.1, w: -86.9, n: 21.2, e: -86.8 });
  assert.equal(again.cached, true);
  assert.equal(calls.length, 3);                                // cache : aucune nouvelle requête
  // Toujours 429 → erreur claire, rien en cache
  setOsmFetch(async () => new Response("", { status: 429 }), async () => {});
  await assert.rejects(overpass("[out:json];node(1);out;"), /saturés.*trop de requêtes/);
  setOsmFetch(null);
});

test("Overpass : 502 / 504 « server at capacity » → autre serveur, attente annoncée, tuiles, ordre réglable", async () => {
  const seen: string[] = [], events: OsmEvent[] = [];
  setOsmFetch(async (u, init) => {
    seen.push(new URL(u).hostname);
    if (u.includes("overpass-api.de")) return new Response("<html>502 Bad Gateway: server at capacity</html>", { status: 502 });
    if (u.includes("private.coffee") && String(init.body).includes("(21.3%2C")) return new Response("busy", { status: 504, headers: { "Retry-After": "3" } });
    return Response.json({ elements: [ELEMENTS[0]] });
  }, async () => {});
  // Zone de 0,6° × 0,6° → 4 tuiles (une requête légère chacune), doublons fusionnés
  const r = await searchOsm(["shop=beauty"], { s: 21.0, w: -87.2, n: 21.6, e: -86.6 }, { onEvent: (e) => events.push(e) });
  assert.equal(r.tiles, 4);
  assert.equal(r.candidates.length, 1);
  assert.ok(events.some((e) => e.type === "wait" && e.server === "overpass-api.de" && e.next === "overpass.private.coffee" && /saturé/.test(e.reason)));
  assert.ok(events.some((e) => e.type === "tile" && e.tile === 4));
  assert.ok(seen.includes("overpass.private.coffee") && seen.includes("maps.mail.ru"));
  // « Réessayer avec un autre serveur » : on commence par le 2e de la liste ; ordre et OVERPASS_URL réglables
  saveOsmInstances(["https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter", "http://pas-https.example/x"]);
  assert.deepEqual(osmInstances(), ["https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter"]);
  process.env.OVERPASS_URL = "https://overpass.example.org/api/interpreter";
  assert.equal(osmInstances()[0], "https://overpass.example.org/api/interpreter");
  delete process.env.OVERPASS_URL;
  db.exec("DELETE FROM settings WHERE key = 'osm_instances'");
  seen.length = 0;
  await searchOsm(["shop=hairdresser"], { s: 21.3, w: -86.9, n: 21.4, e: -86.8 }, { prefer: 1 });
  assert.equal(seen[0], "overpass.private.coffee");
  // Tous saturés : message humain, pas de code HTTP brut seul
  setOsmFetch(async () => new Response("", { status: 504 }), async () => {});
  await assert.rejects(searchOsm(["shop=spa"], { s: 21.3, w: -86.9, n: 21.4, e: -86.8 }), (e: Error) => /serveurs OpenStreetMap sont saturés/.test(e.message) && /Réessaie/.test(e.message));
  setOsmFetch(null);
});

// ---------- Overture (petit extrait, chargé par le vrai script) ----------
// Lignes au format produit par scripts/overture_sync.py (schéma Overture 2026-11 : taxonomy, basic_category).
const OV = [
  { id: "a1b2c3d4-0001", name: "Nail Bar Beauty Lounge", category: "nail_salon", basic_category: "personal_or_beauty_service", alts: ["lifestyle_services", "personal_or_beauty_service", "nail_salon"], confidence: 0.98, operating_status: null, websites: ["http://linktr.ee/nailbar"], emails: ["nailbar@gmail.com"], socials: ["https://www.facebook.com/264155203781286"], phones: ["+529983526341"], addresses: [{ freeform: "Gran Plaza, SM 51", locality: "Cancún", postcode: "77533", region: null, country: "MX" }], lng: -86.853, lat: 21.141 },
  { id: "a1b2c3d4-0002", name: "Estetica Looks", category: "nail_salon", basic_category: "personal_or_beauty_service", alts: [], confidence: 0.36, operating_status: null, websites: null, emails: null, socials: ["https://www.facebook.com/473673079326727"], phones: null, addresses: [{ freeform: "Avenida Nichupte", locality: "Cancún", postcode: "", region: null, country: "MX" }], lng: -86.85, lat: 21.15 },
  { id: "a1b2c3d4-0003", name: "Dental Care Cancún", category: "general_dentistry", basic_category: "dental_clinic", alts: ["health_care", "dental_clinic"], confidence: 0.91, operating_status: "permanently_closed", websites: ["www.dentalcare.mx"], emails: null, socials: null, phones: ["+529981234567"], addresses: [{ freeform: "Av. Tulum 200", locality: "Cancún", postcode: "77500", region: null, country: "MX" }], lng: -86.83, lat: 21.16 },
  { id: "a1b2c3d4-0004", name: "Belize Store", category: "grocery_store", basic_category: "grocery_store", alts: [], confidence: 0.9, operating_status: null, websites: null, emails: null, socials: null, phones: null, addresses: [{ freeform: "", locality: "Corozal", postcode: "", region: null, country: "BZ" }], lng: -88.39, lat: 18.39 },
];
test("Overture : chargement d'un extrait (script réel), recherche locale et ajout", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ov-"));
  const f = path.join(dir, "extrait.ndjson");
  fs.writeFileSync(f, OV.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const out = execFileSync("python3", [path.resolve("scripts/overture_sync.py"), "--db", process.env.DATABASE_PATH!, "--from-ndjson", f, "--release", "2026-11-18.0"], { cwd: dir, encoding: "utf8" });
  assert.match(out, /3 lieux chargés/);                               // le lieu du Belize est écarté
  assert.equal(overtureMeta().release, "2026-11-18.0");
  const all = searchOverture({ categories: [], niche: "Beauté & coiffure" });
  assert.deepEqual(all.candidates.map((c) => c.nom), ["Nail Bar Beauty Lounge", "Estetica Looks"]);
  assert.equal(searchOverture({ categories: ["nail_salon"], tel: true }).total, 1);
  assert.equal(searchOverture({ categories: ["nail_salon"], minConfidence: 0.5 }).total, 1);
  assert.equal(searchOverture({ categories: ["general_dentistry"], excludeClosed: true }).total, 0);
  assert.equal(searchOverture({ categories: ["general_dentistry"], excludeClosed: false }).total, 1);
  const c = searchOverture({ categories: ["nail_salon"], email: true }).candidates[0];
  assert.deepEqual([c.telephone, c.email, c.site_web, c.facebook, c.ville, c.niche], ["+529983526341", "nailbar@gmail.com", "http://linktr.ee/nailbar", "https://www.facebook.com/264155203781286", "Cancún", "Beauté & coiffure"]);
  const r = addCandidates([c]);
  const b = getBusiness(r.ids[c.sourceId])!;
  assert.deepEqual([b.source, b.sources, b.overture_id, b.geo_source], ["Overture", "overture", "a1b2c3d4-0001", "overture"]);
  // Zone refusée hors Quintana Roo (jamais le monde entier)
  assert.throws(() => execFileSync("python3", [path.resolve("scripts/overture_sync.py"), "--bbox=-180,-90,180,90", "--db", "x.db"], { cwd: dir, stdio: "pipe" }), /Zone refusée/);
});

// ---------- Enrichissement ----------
const HOME = `<!doctype html><html><head><script>var x = "tracker@sentry.io"; fetch("/api")</script></head><body>
  <a href="/contacto">Contacto</a> <a href="https://www.facebook.com/sharer/sharer.php?u=x">Compartir</a>
  <a href="https://www.facebook.com/salonluna/">Facebook</a> <a href="https://instagram.com/salon.luna?hl=es">IG</a>
  <a href="https://www.tiktok.com/@salonluna">TikTok</a> <img src="logo@2x.png"> <p>Escríbenos: info@example.com</p>
  <a href="https://wa.me/5219981112233?text=Hola">WhatsApp</a></body></html>`;
const CONTACT = `<html><body><a href="mailto:Citas@SalonLuna.mx?subject=Cita">Escríbenos</a> ventas [at] salonluna.mx
  <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="5d2f382e382f2b3c2e1d2e3c3132333128333c733025">[email protected]</a></body></html>`;

test("extraction : emails (mailto, texte, Cloudflare), réseaux, wa.me, emails génériques ignorés", () => {
  const f = extract(HOME, "https://salonluna.mx/");
  assert.deepEqual(f.emails, []);                                      // sentry, example, image@2x ignorés ; le script n'est pas lu
  assert.equal(f.facebook, "https://www.facebook.com/salonluna");
  assert.equal(f.instagram, "https://instagram.com/salon.luna");
  assert.equal(f.tiktok, "https://www.tiktok.com/@salonluna");
  assert.equal(f.whatsapp, "5219981112233");
  const c = extract(CONTACT, "https://salonluna.mx/contacto");
  assert.ok(c.emails.includes("citas@salonluna.mx"));
  assert.ok(c.emails.includes("ventas@salonluna.mx"));
  assert.ok(c.emails.includes("reservas@salonluna.mx"));             // protection Cloudflare décodée
  assert.equal(extract('<a href="https://api.whatsapp.com/send?phone=529987776655">WA</a>', "https://x.mx").whatsapp, "529987776655");
  assert.ok(!usefulEmail("user@domain.com") && !usefulEmail("noreply@salon.mx") && usefulEmail("hola@salon.mx"));
  assert.deepEqual(contactPages("https://salonluna.mx/", f.links), ["https://salonluna.mx/contacto"]);
  assert.deepEqual(contactPages("https://x.mx/", []), ["https://x.mx/contacto", "https://x.mx/contact"]);
});

test("robots.txt", () => {
  const r = "User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: BadBot\nDisallow: /";
  assert.ok(robotsAllows(r, "/"));
  assert.ok(!robotsAllows(r, "/private/x"));
  assert.ok(robotsAllows(r, "/private/ok"));
  assert.ok(!robotsAllows("User-agent: *\nDisallow: /", "/contacto"));
  assert.ok(robotsAllows("User-agent: *\nDisallow:", "/contacto"));
  assert.ok(!robotsAllows("User-agent: bedoltcrm\nDisallow: /\n\nUser-agent: *\nAllow: /", "/"));
  assert.ok(robotsAllows("", "/x"));
});

/** Faux Internet : domaine → IP publique ; IP+chemin → réponse. */
function fakeWeb(pages: Record<string, { status?: number; body?: string; type?: string; location?: string }>, dnsMap: Record<string, string[]> = {}) {
  const hits: string[] = [];
  const resolve = async (h: string) => dnsMap[h] ?? ["93.184.216.34"];
  const transport: Transport = async (_ip, url) => {
    hits.push(url.toString());
    const p = pages[url.toString()];
    if (!p) return { status: 404, headers: { "content-type": "text/html" }, body: Buffer.from("not found"), truncated: false };
    return { status: p.status ?? (p.location ? 301 : 200), headers: { "content-type": p.type ?? "text/html; charset=utf-8", ...(p.location ? { location: p.location } : {}) }, body: Buffer.from(p.body ?? ""), truncated: false };
  };
  const waits: number[] = [];
  setEnrichDeps({ resolve, transport, sleep: async (ms) => { waits.push(ms); }, perDomainMs: 1000 });
  return { hits, waits };
}

test("enrichissement : champs vides seulement, origine, WhatsApp oui + numéro, ne pas contacter conservé, 1 req/s par domaine", async () => {
  const id = insertBusiness({ nom: "Salón Luna", telephone: "9981112222", site_web: "https://salonluna.mx", instagram: "https://www.instagram.com/deja_la" });
  setDnc([id], true);
  const web = fakeWeb({
    "https://salonluna.mx/robots.txt": { body: "User-agent: *\nDisallow: /admin", type: "text/plain" },
    "https://salonluna.mx/": { body: HOME }, "https://salonluna.mx/contacto": { body: CONTACT },
  });
  const o = await enrichBusiness(id);
  assert.equal(o.result, "trouve");
  const b = getBusiness(id)!;
  assert.equal(b.email, "citas@salonluna.mx");
  assert.equal(b.facebook, "https://www.facebook.com/salonluna");
  assert.equal(b.instagram, "https://www.instagram.com/deja_la");      // déjà rempli : jamais écrasé
  assert.equal(b.tiktok, "https://www.tiktok.com/@salonluna");
  assert.deepEqual([b.wa_confirme, b.whatsapp], [1, "529981112233"]);   // wa.me : WhatsApp = oui ; même numéro → pas de 2e numéro
  assert.equal(b.ne_pas_contacter, 1);
  assert.equal(b.enrich_status, "trouve");
  assert.match(originsOf(id).find((x) => x.field === "email")!.origin, /^email trouvé sur salonluna\.mx\/contacto le \d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(web.hits, ["https://salonluna.mx/robots.txt", "https://salonluna.mx/", "https://salonluna.mx/contacto"]);
  assert.ok(web.waits.every((w) => w > 0 && w <= 1000) && web.waits.length === 2);   // pause entre deux requêtes au même domaine
  // Rien à ajouter la 2e fois
  assert.equal((await enrichBusiness(id)).result, "rien");
});

test("enrichissement : robots.txt, site injoignable, redirection vers IP interne, file persistante", async () => {
  const a = insertBusiness({ nom: "A", site_web: "https://interdit.mx" });
  fakeWeb({ "https://interdit.mx/robots.txt": { body: "User-agent: *\nDisallow: /", type: "text/plain" }, "https://interdit.mx/": { body: HOME } });
  assert.equal((await enrichBusiness(a)).result, "robots");
  const b = insertBusiness({ nom: "B", site_web: "https://piege.mx" });
  const w = fakeWeb({ "https://piege.mx/": { location: "http://169.254.169.254/latest/meta-data/" } });
  const o = await enrichBusiness(b);
  assert.equal(o.result, "bloque");
  assert.match(o.detail, /169\.254\.169\.254/);
  assert.ok(!w.hits.some((h) => h.includes("169.254")));               // jamais contacté
  const c = insertBusiness({ nom: "C", site_web: "https://interne.mx" });
  fakeWeb({}, { "interne.mx": ["10.0.0.7"] });
  assert.equal((await enrichBusiness(c)).result, "bloque");
  // File : seulement site + pas d'email ; traitement et reprise
  db.prepare("UPDATE businesses SET enrich_status = '' ").run();
  const d = insertBusiness({ nom: "D", site_web: "https://d.mx", email: "deja@d.mx" });
  db.exec("DELETE FROM enrich_queue");
  const n = enqueueEnrich();
  assert.equal(n, 3);                                                   // a, b, c (d a déjà un email)
  assert.deepEqual([enrichStatus().pending, enrichStatus().total], [3, 3]);
  fakeWeb({});
  assert.equal(await tick(), 3);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM enrich_queue WHERE done_at IS NOT NULL").get() as { n: number }).n, 3);
  assert.equal(getBusiness(d)!.enrich_status, "");
  const st = enrichStatus();
  assert.deepEqual([st.done, st.pending, st.failed + st.nothing + st.found], [3, 0, 3]);
});

// ---------- SSRF ----------
test("SSRF : IP privées, loopback, link-local, métadonnées, Tailscale, DNS privé, ports, protocoles", async () => {
  for (const u of ["http://127.0.0.1/", "http://10.1.2.3/", "http://192.168.1.1/", "http://172.20.0.1/", "http://169.254.169.254/latest/meta-data/",
    "http://100.101.102.103/", "http://[::1]/", "http://[::ffff:10.0.0.1]/", "http://[fd7a:115c:a1e0::1]/", "http://[fe80::1]/", "http://0.0.0.0/",
    "http://localhost/", "http://router.local/", "http://pc.tail1234.ts.net/"]) {
    await assert.rejects(vetUrl(u, async () => ["93.184.216.34"]), FetchBlocked, u);
  }
  await assert.rejects(vetUrl("ftp://exemple.mx/"), /Protocole/);
  await assert.rejects(vetUrl("http://exemple.mx:8080/"), /Port/);
  await assert.rejects(vetUrl("http://user:pass@exemple.mx/"), /Identifiants/);
  await assert.rejects(vetUrl("https://rebind.exemple.mx/", async () => ["93.184.216.34", "127.0.0.1"]), /interne/);   // une seule adresse privée suffit
  await assert.rejects(vetUrl("https://prive.exemple.mx/", async () => ["192.168.0.10"]), /interne/);
  assert.equal((await vetUrl("https://ok.exemple.mx/", async () => ["93.184.216.34"])).ip, "93.184.216.34");
  assert.equal(publicIpRefusal("8.8.8.8"), null);
  assert.equal(publicIpRefusal("2606:4700:4700::1111"), null);
  // Redirection vers un nom qui résout en privé : refusée avant connexion
  let hits = 0;
  const t: Transport = async () => { hits++; return { status: 302, headers: { location: "https://intranet.exemple.mx/" }, body: Buffer.alloc(0), truncated: false }; };
  await assert.rejects(safeGet("https://public.exemple.mx/", { transport: t, resolve: async (h) => (h === "intranet.exemple.mx" ? ["10.9.9.9"] : ["93.184.216.34"]) }), /interne/);
  assert.equal(hits, 1);
  // Contenu non textuel ignoré
  const bin: Transport = async () => ({ status: 200, headers: { "content-type": "application/pdf" }, body: Buffer.from("%PDF"), truncated: false });
  await assert.rejects(safeGet("https://x.exemple.mx/a.pdf", { transport: bin, resolve: async () => ["93.184.216.34"] }), /non textuel/);
});

test("limites : 1 Mo maximum, délai d'expiration (vrai serveur HTTP local, transport seul)", async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === "/gros") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("x".repeat(3 * 1024 * 1024)); }
    else { setTimeout(() => res.end("trop tard"), 3000); }
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  try {
    const big = await httpTransport("127.0.0.1", new URL(`http://127.0.0.1:${port}/gros`), { timeoutMs: 5000, maxBytes: 1024 * 1024 });
    assert.equal(big.body.length, 1024 * 1024);
    assert.equal(big.truncated, true);
    const t0 = Date.now();
    await assert.rejects(httpTransport("127.0.0.1", new URL(`http://127.0.0.1:${port}/lent`), { timeoutMs: 300, maxBytes: 1024 }), /Délai dépassé/);
    assert.ok(Date.now() - t0 < 2000);
    // Le même serveur via safeGet : refusé (loopback), jamais contacté
    await assert.rejects(safeGet(`http://127.0.0.1/gros`), /loopback/);
  } finally { srv.close(); }
});

// ---------- Google Places (optionnel) ----------
test("Google Places : aucune requête sans clé ; avec clé, champs vides complétés et compteur du mois", async () => {
  const id = insertBusiness({ nom: "Uñas Mía", ville: "Cancún" });
  let calls = 0;
  setGoogleFetch(async () => { calls++; return Response.json({ places: [{ id: "ChIJ123", displayName: { text: "Uñas Mía" }, rating: 4.7, userRatingCount: 58, websiteUri: "https://unasmia.mx", internationalPhoneNumber: "+52 998 555 6677", googleMapsUri: "https://maps.google.com/?cid=1", businessStatus: "OPERATIONAL" }] }); });
  delete process.env.GOOGLE_PLACES_KEY;
  await assert.rejects(checkOnGoogle(id), /désactivé/);
  assert.equal(calls, 0);
  process.env.GOOGLE_PLACES_KEY = "AIzaTESTKEY_0123456789abcdef";
  const r = await checkOnGoogle(id);
  delete process.env.GOOGLE_PLACES_KEY;
  assert.equal(r.found, true);
  const b = getBusiness(id)!;
  assert.deepEqual([b.fiche_google, b.note_google, b.nb_avis, b.site_web, b.tel_norm], ["oui", 4.7, 58, "https://unasmia.mx", "9985556677"]);
  assert.equal(googleUsage(), 1);
  setGoogleFetch(null);
});

// ---------- Stats par source ----------
test("stats par source : volumes, contacts, réponses, intérêt (fiche multi-sources comptée dans chacune)", () => {
  const a = insertBusiness({ nom: "A", telephone: "9981000001", email: "a@a.mx", source: "DENUE", sources: "denue,osm" });
  const b = insertBusiness({ nom: "B", telephone: "9981000002", source: "OSM", sources: "osm" });
  insertBusiness({ nom: "C", source: "Excel", site_web: "https://c.mx" });
  setStatus(a, "contacte"); setStatus(a, "a_repondu"); setStatus(a, "interesse");
  setStatus(b, "contacte");
  const s = Object.fromEntries(sourceStats().map((x) => [x.key, x]));
  assert.deepEqual([s.osm.total, s.osm.tel, s.osm.email, s.osm.contactes, s.osm.repondu, s.osm.interesse], [2, 2, 1, 2, 1, 1]);
  assert.deepEqual([s.denue.total, s.denue.interesse], [1, 1]);
  assert.deepEqual([s.excel.total, s.excel.site, s.excel.contactes], [1, 1, 0]);
  assert.equal(s.osm.label, "OpenStreetMap");
});
