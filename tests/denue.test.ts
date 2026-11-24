import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { setDenueFetch, buscar, nombre, buscarEntidad, ficha, cuantificar, buscarArea, mapRow, call, denueTest, PAGE } from "@/lib/denue";
import { runSearch, existingIndex, addRows, refreshFromDenue, type AddItem } from "@/lib/denue-run";
import { saveSearch, runSaved, newCounts, newRows, dismissNew, dueSearches, market } from "@/lib/denue-watch";
import { searchScian } from "@/lib/scian";
import { saveNiches, nicheFor } from "@/lib/niches";
import { insertBusiness, getBusiness } from "@/lib/crm";
import { fakeInegi, areaRow, TOKEN } from "./fixtures";

const install = (o: Parameters<typeof fakeInegi>[0] = {}) => { const f = fakeInegi(o); setDenueFetch(f.fetcher as never); return f; };
const zone = { mode: "zone" as const, entidad: "23", municipio: "005", localidad: "", codes: ["812110"], estrato: "", nombre: "" };

beforeEach(() => {
  setSetting("denue_token", TOKEN);
  db.exec("DELETE FROM denue_cache; DELETE FROM denue_seen; DELETE FROM denue_searches; DELETE FROM businesses; DELETE FROM settings WHERE key='denue_niches';");
});

test("chaque méthode : format exact de l'URL, token en dernier segment", async () => {
  const f = install();
  await buscar(21.16, -86.85, 9000, "salon, spa");
  await nombre("salon belleza", 1, 10);
  await buscarEntidad("uñas", 11, 20);
  await ficha("9000005");
  await cuantificar(["812110", "722511"], ["23005", "23008"], "1");
  await buscarArea({ municipio: "005", localidad: "0001", code: "812110", estrato: "2" }, 1, 500);
  await buscarArea({ municipio: "008", code: "81211" }, 1, 500);
  assert.deepEqual(f.calls.map((c) => c.path), [
    "Buscar/salon%2Cspa/21.160000,-86.850000/5000",                   // rayon borné à 5 000 m
    "Nombre/salon%20belleza/23/1/10",
    "BuscarEntidad/u%C3%B1as/23/11/20",
    "Ficha/9000005",
    "Cuantificar/812110,722511/23005,23008/1",
    "BuscarAreaActEstr/23/005/0001/0/0/0/0/0/812110/0/1/500/0/2",     // 14 segments (Id = 0 avant l'estrato)
    "BuscarAreaActEstr/23/008/0/0/0/0/0/8121/0/0/1/500/0/0",          // sous-branche (5 chiffres) → branche + filtre
  ]);
  assert.ok(f.calls.every((c) => c.token === TOKEN));
});

test("mapRow : champs DENUE → CRM (ville officielle, email, site, strate, alta, classe)", () => {
  const r = mapRow(areaRow(3));
  assert.equal(r.ville, "Cancún");                 // AreaGeo 230050001 → catalogue des localidades
  assert.equal(r.mun, "005");
  assert.equal(r.colonia, "Supermanzana 63");
  assert.equal(r.email, "salon3@gmail.com");
  assert.equal(r.strate, 1);
  assert.equal(r.classe, "812110");
  assert.equal(r.alta, "2015-12");
  assert.equal(mapRow(areaRow(5)).site_web, "http://www.salon5.com");
  // Méthodes sans CLASE_ACTIVIDAD_ID : classe retrouvée par l'intitulé officiel
  const { CLASE_ACTIVIDAD_ID: _x, AreaGeo: _y, ...short } = areaRow(1);
  assert.equal(mapRow(short).classe, "812110");
  assert.equal(mapRow(short).ville, "Cancún");      // Ubicacion « CANCÚN, Benito Juárez, … »
});

test("pagination complète : Cuantificar puis toutes les pages jusqu'à la page incomplète", async () => {
  const f = install({ total: 1234 });
  const steps: string[] = [];
  const r = await runSearch(zone, (p) => steps.push(p.step));
  assert.equal(r.rows.length, 1234);
  assert.equal(r.expected, 1234);
  assert.equal(new Set(r.rows.map((x) => x.clee)).size, 1234);
  assert.deepEqual(f.calls.map((c) => c.path.split("/").slice(0, 1).concat(c.path.split("/").slice(11, 13)).join("/")),
    ["Cuantificar", "BuscarAreaActEstr/1/500", "BuscarAreaActEstr/501/1000", "BuscarAreaActEstr/1001/1500"]);
  assert.ok(steps.some((s) => s.includes("page 3 / 3")));
  assert.equal(PAGE, 500);
});

test("total multiple de la taille de page : une page vide termine", async () => {
  install({ total: 1000 });
  const r = await runSearch(zone);
  assert.equal(r.rows.length, 1000);
});

test("reprise : panne réseau et 503 réessayés automatiquement", async () => {
  const f = install({ total: 700, failOn: [2], status503On: [4] });
  const r = await runSearch(zone);
  assert.equal(r.rows.length, 700);
  assert.equal(r.partial, undefined);
  assert.equal(f.calls.length, 5); // cuantificar, page1 (échec) + reprise, page2 (503) + reprise
});

test("erreur persistante en cours de route : résultat partiel, puis relance = reprise grâce au cache", async () => {
  const f = install({ total: 1234, failOn: [3, 4, 5] });   // page 2 : 3 échecs
  const r = await runSearch(zone);
  assert.equal(r.rows.length, 500);
  assert.match(r.partial ?? "", /injoignable/);
  const before = f.calls.length;
  const r2 = await runSearch(zone);
  assert.equal(r2.rows.length, 1234);
  // Cuantificar et page 1 viennent du cache : seules les pages 2 et 3 sont redemandées
  assert.equal(f.calls.length - before, 2);
});

test("cache 24 h : pas de nouvelle requête, puis expiration", async () => {
  const f = install();
  await cuantificar(["812110"], ["23005"]);
  await cuantificar(["812110"], ["23005"]);
  assert.equal(f.calls.length, 1);
  const k = db.prepare("SELECT k FROM denue_cache").get() as { k: string };
  assert.ok(!k.k.includes(TOKEN), "le token n'est jamais stocké dans le cache");
  db.prepare("UPDATE denue_cache SET at = at - ?").run(25 * 3600_000);
  await cuantificar(["812110"], ["23005"]);
  assert.equal(f.calls.length, 2);
});

test("token refusé : message clair, sans le token, sans reprise ni cache", async () => {
  const f = install({ badToken: true });
  await assert.rejects(call("Ficha/1"), (e: Error) => /Token DENUE refusé/.test(e.message) && !e.message.includes(TOKEN));
  assert.equal(f.calls.length, 1);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM denue_cache").get() as { n: number }).n, 0);
  assert.equal((await denueTest()).ok, false);
});

test("Cuantificar : volume par activité × zone", async () => {
  install({ total: 321 });
  const c = await cuantificar(["812110", "722511"], ["23005", "23008"], "1");
  assert.deepEqual(c.find((x) => x.ae === "812110" && x.ag === "23005"), { ae: "812110", ag: "23005", total: 321 });
  assert.equal(c.length, 4);
});

test("modes point et nom (Nombre / BuscarEntidad paginés, filtre d'activité)", async () => {
  install();
  const p = await runSearch({ mode: "point", lat: 21.16, lng: -86.85, rayon: 800, condition: "", codes: ["8121"] });
  assert.equal(p.rows.length, 3);
  const n = await runSearch({ mode: "nom", q: "salon", method: "nombre", entidad: "23", codes: [] });
  assert.equal(n.rows.length, 620);                       // 2 pages (500 + 120)
  const e = await runSearch({ mode: "nom", q: "salon", method: "entidad", entidad: "23", codes: ["722511"] });
  assert.equal(e.rows.length, 0);                         // aucune ligne de la classe demandée
});

test("dédoublonnage : CLEE, puis téléphone normalisé, puis nom + distance < 100 m", () => {
  const a = mapRow(areaRow(1)), b = mapRow(areaRow(3)), c = mapRow(areaRow(7)), d = mapRow(areaRow(9));
  const idA = insertBusiness({ nom: "Autre nom", denue_id: a.clee, source: "DENUE" });
  const idB = insertBusiness({ nom: "Salon B", telephone: "+52 998 100 0003".replace("100 0003", b.telephone.slice(3, 6) + " " + b.telephone.slice(6)) });
  const idC = insertBusiness({ nom: "Salón de Belleza núm. 7", lat: c.lat! + 0.0003, lng: c.lng! });   // ~33 m
  insertBusiness({ nom: "Salon de belleza num 9", lat: d.lat! + 0.005, lng: d.lng! });                 // ~550 m : différent
  const find = existingIndex();
  assert.deepEqual([find(a)?.id, find(a)?.reason], [idA, "id"]);
  assert.deepEqual([find(b)?.id, find(b)?.reason], [idB, "tel"]);
  assert.deepEqual([find(c)?.id, find(c)?.reason], [idC, "nom"]);
  assert.equal(find(d), null);
});

const item = (i: number): AddItem => {
  const r = mapRow(areaRow(i));
  return { ...r, fiche_google: "", interet: "", note: "" };
};

test("ajout groupé : transaction, niche via Mes niches, zone = colonia, position DENUE, doublons ignorés", () => {
  saveNiches([{ label: "Beauté & coiffure", codes: ["8121"] }, { label: "Ongles", codes: ["812110"] }]);
  assert.equal(nicheFor("812110"), "Ongles");     // le code le plus précis l'emporte
  const items = [item(1), item(2), item(3), item(1)];
  const r = addRows(items, "Beauté Cancún");
  assert.equal(r.added, 3);
  assert.equal(r.skipped, 1);
  const b = getBusiness(r.ids[items[2].clee])!;
  assert.equal(b.statut, "a_contacter");
  assert.equal(b.niche, "Ongles");
  assert.equal(b.zone, "Supermanzana 63");
  assert.equal(b.email, "salon3@gmail.com");
  assert.equal(b.geo_source, "denue");
  assert.equal(b.source, "DENUE");
  assert.match(b.source_detail, /^DENUE · \d{4}-\d{2}-\d{2} · Beauté Cancún$/);
  assert.equal(b.denue_num, "9000003");
  assert.equal(addRows([item(2)]).added, 0);
  // Tout ou rien : une erreur au milieu annule tout
  const before = (db.prepare("SELECT COUNT(*) n FROM businesses").get() as { n: number }).n;
  assert.throws(() => addRows([item(20), { ...item(21), nom: null as unknown as string }]));
  assert.equal((db.prepare("SELECT COUNT(*) n FROM businesses").get() as { n: number }).n, before);
});

test("veille : la 1re exécution sert de base, ensuite seuls les CLEE jamais vus sont nouveaux", async () => {
  install({ total: 10 });
  const id = saveSearch({ name: "Salons Cancún", params: zone, watch: true });
  assert.deepEqual(dueSearches(), [id]);
  const first = await runSaved(id);
  assert.deepEqual([first.total, first.fresh], [10, 0]);
  assert.deepEqual(dueSearches(), []);              // relancée dans 7 jours
  db.exec("DELETE FROM denue_cache");
  install({ total: 13 });
  const second = await runSaved(id);
  assert.equal(second.fresh, 3);
  assert.equal(newCounts().get(id), 3);
  assert.deepEqual(newRows(id).map((r) => r.nom).sort(), ["Salon de Belleza Num 11", "Salon de Belleza Num 12", "Salon de Belleza Num 13"]);
  // Aucun ajout automatique au CRM
  assert.equal((db.prepare("SELECT COUNT(*) n FROM businesses").get() as { n: number }).n, 0);
  // Ajouté depuis la veille → n'est plus compté ; « marquer comme vus » → plus rien
  addRows([item(11)]);
  assert.equal(newCounts().get(id), 2);
  dismissNew(id);
  assert.equal(newCounts().get(id) ?? 0, 0);
  db.prepare("UPDATE denue_searches SET last_run_at = ?").run(new Date(Date.now() - 8 * 86400_000).toISOString());
  assert.deepEqual(dueSearches(), [id]);
});

test("enregistrer depuis des résultats affichés : ils ne seront pas « nouveaux »", async () => {
  install({ total: 5 });
  const r = await runSearch(zone);
  const id = saveSearch({ name: "x", params: zone, watch: true, seen: r.rows.map((x) => x.clee) });
  db.exec("DELETE FROM denue_cache");
  install({ total: 6 });
  assert.equal((await runSaved(id)).fresh, 1);
});

test("Ficha : « Mettre à jour depuis DENUE » complète la fiche", async () => {
  install();
  const r = addRows([item(2)]);
  const id = Object.values(r.ids)[0];
  const u = await refreshFromDenue(id);
  assert.ok(u.changed.includes("email"));
  assert.equal(getBusiness(id)!.email, "nuevo@salon.mx");
  assert.equal(getBusiness(id)!.tel_norm, "9988776655");
});

test("Marché : Cuantificar (une requête) vs fiches du CRM par municipio", async () => {
  const f = install({ total: 40 });
  saveNiches([{ label: "Beauté & coiffure", codes: ["812110"] }]);
  addRows([item(1), item(2)]);
  insertBusiness({ nom: "Salon Playa", niche: "Beauté & coiffure", ville: "Playa del Carmen" });
  const m = await market();
  assert.equal(f.calls.filter((c) => c.path.startsWith("Cuantificar")).length, 1);
  assert.deepEqual(m.cells["Beauté & coiffure|005"], { denue: 40, crm: 2, contactes: 0, clients: 0 });
  assert.equal(m.cells["Beauté & coiffure|008"].crm, 1);
  assert.equal(m.cells["Beauté & coiffure|008"].denue, 0);
});

test("SCIAN : recherche par mot-clé en espagnol et en français", () => {
  const top = (q: string) => searchScian(q, 3).map((h) => h.code);
  assert.ok(top("uñas").includes("812110"));
  assert.ok(top("ongles").includes("812110"));
  assert.ok(top("coiffure").includes("812110"));
  assert.ok(top("barbería").includes("812110"));
  assert.ok(top("barbier").includes("812110"));
  assert.equal(top("dentista")[0], "621211");
  assert.equal(top("dentiste")[0], "621211");
  assert.ok(top("restaurante").every((c) => c.startsWith("7225")));
  assert.ok(top("spa").includes("812110"));
  assert.equal(top("8121")[0], "8121");
});
