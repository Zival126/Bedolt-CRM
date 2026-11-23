import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { insertBusiness, queryBusinesses, idsForFilter, bulkAddTag, setDnc, getBusiness, waState, setStatus } from "@/lib/crm";
import { readFilters, readMapFilters } from "@/lib/filters";
import { ensureQueue, todayQueue, todayQueueIds } from "@/lib/queue";
import { applyResult, undoResult } from "@/lib/outcomes";
import { panelItem } from "@/lib/panel";
import { buildCsv } from "@/lib/export-csv";
import { saveView, savedViews, deleteView, commerceColumns, saveColumns, cleanQuery } from "@/lib/views";
import { ColumnsSchema, DEFAULT_COLUMNS, csvCell } from "@/lib/columns";
import { normalizeSocial, socialHref } from "@/lib/contacts";
import { setSetting } from "@/lib/settings";
import { parseRow, mappingFor, detectFormat } from "@/lib/import";

let A = 0, B = 0, C = 0, D = 0;
beforeEach(() => {
  db.exec("DELETE FROM businesses; DELETE FROM daily_queue; DELETE FROM queue_meta; DELETE FROM saved_views; DELETE FROM settings WHERE key IN ('commerce_columns','objectives');");
  A = insertBusiness({ nom: "Uñas Bonitas 💅", telephone: "998 111 2222", email: "hola@unas.mx", site_web: "https://unas.mx", niche: "Beauté", ville: "Cancún", lat: 21.16, lng: -86.85, source: "DENUE" });
  B = insertBusiness({ nom: "Barbería Don José", telephone: "9982223333", niche: "Beauté", ville: "Cancún", source: "Excel", facebook: "https://www.facebook.com/donjose" });
  C = insertBusiness({ nom: "Spa Sin Teléfono", email: "spa@correo.com", niche: "Spa", ville: "Tulum" });
  D = insertBusiness({ nom: "Dentista Sonrisa", telephone: "9984445555", niche: "Dentistes", ville: "Playa del Carmen", lat: 20.62, lng: -87.07 });
  db.prepare("UPDATE businesses SET no_whatsapp = 1 WHERE id = ?").run(D);
  db.prepare("UPDATE businesses SET wa_confirme = 1 WHERE id = ?").run(A);
});

const ids = (sp: Record<string, string>) => idsForFilter(readFilters({ vue: "toutes", ...sp }).f).sort((x, y) => x - y);

test("chaque filtre de contact", () => {
  assert.deepEqual(ids({ email: "1" }), [A, C]);
  assert.deepEqual(ids({ email: "0" }), [B, D]);
  assert.deepEqual(ids({ site: "1" }), [A]);
  assert.deepEqual(ids({ site: "0" }), [B, C, D]);
  assert.deepEqual(ids({ tel: "1" }), [A, B, D]);
  assert.deepEqual(ids({ tel: "0" }), [C]);
  assert.deepEqual(ids({ wa: "oui" }), [A]);
  assert.deepEqual(ids({ wa: "non" }), [D]);
  assert.deepEqual(ids({ wa: "inconnu" }), [B, C]);
  assert.deepEqual(ids({ pos: "1" }), [A, D]);
  assert.deepEqual(ids({ pos: "0" }), [B, C]);
  assert.deepEqual(ids({ source: "denue" }), [A]);
  assert.deepEqual(ids({ source: "Excel" }), [B]);
  // Combinables avec les filtres existants, valeurs inconnues ignorées
  assert.deepEqual(ids({ niche: "Beauté", email: "0" }), [B]);
  assert.deepEqual(ids({ email: "peut-être" }), [A, B, C, D]);
  assert.equal(waState(getBusiness(D)!), "non");
});

test("tri par colonne et ordre inverse", () => {
  const order = (sp: Record<string, string>) => queryBusinesses(readFilters({ vue: "toutes", ...sp }).f).rows.map((r) => r.id);
  assert.deepEqual(order({ sort: "ville" }), [A, B, D, C]);        // Cancún, Cancún, Playa, Tulum
  assert.deepEqual(order({ sort: "ville", dir: "inv" }).slice(0, 2), [C, D]);
  assert.deepEqual(order({ sort: "email" }), [A, C, B, D]);   // vides en dernier
  assert.deepEqual(order({ sort: "email", dir: "inv" }), [C, A, B, D]);
  assert.equal(readFilters({ sort: "nimporte" }).f.sort, "offre");
});

test("étiquettes (action groupée) et filtre", () => {
  assert.equal(bulkAddTag([A, B], "salon VIP"), 2);
  assert.equal(bulkAddTag([A], "salon VIP"), 0);    // pas de doublon
  bulkAddTag([A], "rappel");
  assert.equal(getBusiness(A)!.etiquette, "salon VIP, rappel");
  assert.deepEqual(ids({ tag: "rappel" }), [A]);
  assert.deepEqual(ids({ tag: "salon VIP" }), [A, B]);
});

test("Ne pas contacter : exclu de la file, du focus, de la carte par défaut et de WhatsApp (même en groupe)", () => {
  setSetting("objectives", JSON.stringify({ newGoal: 10, newHard: 20, relances: 10 }));
  ensureQueue();
  assert.ok(todayQueueIds().includes(A));
  assert.equal(setDnc([A, B], true), 2);            // action groupée
  // File du jour (et donc mode focus) : retirées tout de suite
  const q = todayQueueIds();
  assert.ok(!q.includes(A) && !q.includes(B));
  assert.ok(!todayQueue().blocks.nouveaux.items.some((i) => [A, B].includes(i.b.id)));
  // Relances / réponses : jamais remises dans la file
  setStatus(A, "contacte");
  db.prepare("UPDATE businesses SET next_followup = '2000-01-01' WHERE id = ?").run(A);
  db.exec("DELETE FROM daily_queue; DELETE FROM queue_meta;");
  ensureQueue();
  assert.ok(!todayQueueIds().includes(A));
  // Carte : masquées par défaut, visibles avec dnc=tous, seules avec dnc=1
  const map = (sp: Record<string, string>) => idsForFilter(readMapFilters(sp)).sort((x, y) => x - y);
  assert.deepEqual(map({}), [C, D]);
  assert.deepEqual(map({ dnc: "tous" }), [A, B, C, D]);
  assert.deepEqual(map({ dnc: "1" }), [A, B]);
  // Liste Commerces : visibles (badge), filtrables
  assert.deepEqual(ids({}), [A, B, C, D]);
  assert.deepEqual(ids({ dnc: "0" }), [C, D]);
  // WhatsApp : bouton bloqué et enregistrement refusé côté serveur
  assert.match(panelItem(getBusiness(B)!).waBlocked ?? "", /Ne pas contacter/);
  assert.throws(() => applyResult({ id: B, result: "wa_sent", template: "first" }), /Ne pas contacter/);
  // Retirer le marquage : de nouveau éligible
  setDnc([B], false);
  assert.equal(panelItem(getBusiness(B)!).waBlocked, undefined);
  // « À appeler » : jamais les fiches ne pas contacter
  db.prepare("UPDATE businesses SET ne_pas_contacter = 1 WHERE id = ?").run(D);
  assert.deepEqual(ids({ nowa: "1" }), []);
});

test("WhatsApp envoyé → oui ; Pas de WhatsApp → non (et Annuler restaure)", () => {
  applyResult({ id: B, result: "wa_sent", template: "first" });
  assert.equal(waState(getBusiness(B)!), "oui");
  const r = applyResult({ id: B, result: "no_wa", toCall: true });
  assert.equal(waState(getBusiness(B)!), "non");
  undoResult(r.undo);
  assert.equal(waState(getBusiness(B)!), "oui");
});

test("vues enregistrées", () => {
  saveView("Beauté Cancún sans site avec email", "?vue=toutes&niche=Beauté&ville=Cancún&site=0&email=1&page=3");
  const v = savedViews();
  assert.equal(v.length, 1);
  assert.equal(v[0].query, "vue=toutes&niche=Beaut%C3%A9&ville=Canc%C3%BAn&site=0&email=1");   // page retirée
  saveView("beauté cancún sans site avec email", "vue=toutes&email=1");                     // même nom → remplacée
  assert.equal(savedViews().length, 1);
  assert.deepEqual(ids(Object.fromEntries(new URLSearchParams(v[0].query))), []);
  deleteView(v[0].id);
  assert.equal(savedViews().length, 0);
  assert.equal(cleanQuery("page=2&q=x"), "q=x");
});

test("colonnes : choix, ordre, « Commerce » toujours présent", () => {
  assert.deepEqual(commerceColumns(), DEFAULT_COLUMNS);
  saveColumns(ColumnsSchema.parse(["email", "nom", "site"]));
  assert.deepEqual(commerceColumns(), ["nom", "email", "site"]);
  assert.throws(() => ColumnsSchema.parse(["nom", "inconnue"]));
});

test("export CSV : BOM UTF-8, colonnes visibles, accents et emojis, formules neutralisées", () => {
  saveColumns(ColumnsSchema.parse(["nom", "contacts", "ville", "reseaux", "actions"]));
  insertBusiness({ nom: "=HYPERLINK(\"x\")", ville: "Cancún" });
  const { body, rows } = buildCsv({ vue: "toutes", sort: "nom" });
  assert.equal(body.charCodeAt(0), 0xfeff);
  const lines = body.slice(1).split("\r\n");
  assert.equal(lines[0], "Commerce;Téléphone;WhatsApp;Email;Site web;Ville;Facebook;Instagram");
  assert.equal(rows, 5);
  assert.ok(lines.includes("Uñas Bonitas 💅;+52 998 111 2222;oui;hola@unas.mx;https://unas.mx;Cancún;;"));
  assert.ok(lines.some((l) => l.startsWith(`"'=HYPERLINK(""x"")"`)));
  // Filtres appliqués + séparateur virgule
  const e = buildCsv({ vue: "toutes", email: "1", sep: ",", cols: "nom,email" });
  assert.equal(e.rows, 2);
  assert.ok(e.body.includes("Spa Sin Teléfono,spa@correo.com"));
  // Le décodage UTF-8 strict (comme Excel avec BOM) relit exactement les accents / emojis
  const bytes = Buffer.from(body, "utf8");
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(new TextDecoder("utf-8", { fatal: true }).decode(bytes).includes("💅"));
  assert.equal(csvCell("a;b", ";"), '"a;b"');
  assert.equal(csvCell("+52 998 111 2222", ";"), "+52 998 111 2222");
});

test("contacts : liens réseaux normalisés et filtrés", () => {
  assert.equal(normalizeSocial("instagram", "@unas.bonitas"), "https://www.instagram.com/unas.bonitas");
  assert.equal(normalizeSocial("facebook", "facebook.com/donjose"), "https://facebook.com/donjose");
  assert.equal(socialHref("facebook", "https://evil.example/x"), "");
  assert.equal(socialHref("instagram", "javascript:alert(1)"), "");
});

test("import Excel : email / site / réseaux (format Bedolt et standard)", () => {
  const h = ["Entreprise", "Téléphone", "Statut", "Niche", "Offre", "Présence web", "Angle", "Notes", "Note Google", "Avis", "Lien Google Maps", "Message WhatsApp", "Correo", "Sitio web", "Facebook", "Instagram"];
  assert.equal(detectFormat(h), "bedolt");
  const m = mappingFor("bedolt", h);
  const row = ["Salón Luna", "9981234567", "", "Beauté", "P1", "", "", "Centro", "4.5", "12", "", "", "LUNA@Correo.MX", "salonluna.mx", "@salonluna", "instagram.com/salonluna"];
  const p = parseRow(row, m, { defaultVille: "Cancún" });
  assert.equal(p.rec!.email, "luna@correo.mx");
  assert.equal(p.rec!.site_web, "https://salonluna.mx/");
  assert.equal(p.rec!.facebook, "https://www.facebook.com/salonluna");
  assert.equal(p.rec!.instagram, "https://instagram.com/salonluna");
  const s = mappingFor("standard", ["nom", "email", "web", "fb", "ig"]);
  assert.deepEqual([s.email, s.site_web, s.facebook, s.instagram], [1, 2, 3, 4]);
  const bad = parseRow(["X", "", "", "", "", "", "", "", "", "", "", "", "pas-un-email", "", "", ""], m, { defaultVille: "" });
  assert.equal(bad.rec!.email, "");
  assert.ok(bad.warnings.some((w) => /Email ignoré/.test(w)));
});
