import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { migrateV8 } from "@/lib/niche-seed";
import { allNiches } from "@/lib/niches";
import { readFile, detectFormat, mappingFor, analyze, summarize, commit, GEMINI_HEADERS, csvTemplate } from "@/lib/import";
import { buildGeminiPrompt } from "@/lib/gemini-prompt";

beforeEach(() => { db.exec("DELETE FROM businesses; DELETE FROM import_batches; DELETE FROM niche_maps; DELETE FROM niches;"); migrateV8(db); });

const q = (cells: string[]) => cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(",");
const HEAD = "Entreprise,Téléphone,Statut,Niche,Spécialité,Offre,Présence web,Angle,Notes,Note Google,Avis,Lien Google Maps,Message WhatsApp,Email,Site web,Facebook,Instagram,Adresse,Ville";

test("import du CSV Gemini (19 colonnes) : format reconnu, niches reconnues / classées, aucune création implicite, spécialité, lignes douteuses", async () => {
  assert.equal(GEMINI_HEADERS.join(","), HEAD);
  const maps = "https://www.google.com/maps/place/Sal%C3%B3n+Luna/@21.16,-86.85,17z";
  const csv = "﻿" + [HEAD,
    q(["Salón Luna", "+52 998 111 2233", "À contacter", "Beauté & coiffure", "Coloration", "P1", "Aucun site", "Pas de site, 3 photos", "SM 22", "4.6", "124", maps, "¡Hola Salón Luna! 👋", "luna@gmail.com", "", "https://www.facebook.com/salonluna", "https://www.instagram.com/salonluna", "Av. Tulum 12", "Cancún"]),
    q(["Nails Sol", "+52 998 111 2234", "À contacter", "salon de belleza", "", "P2", "Site", "Peu d'avis", "SM 3", "4.1", "9", maps.replace("Luna", "Sol"), "", "", "https://nailssol.mx", "", "", "", "Cancún"]),
    q(["Tatuajes Maya", "+52 998 111 2235", "À contacter", "Tatoueurs", "", "", "Aucun site", "", "Centro", "4.9", "40", maps.replace("Luna", "Maya"), "", "", "", "", "", "", "Playa del Carmen"]),
    q(["Barbería Inventée", "", "À contacter", "Beauté & coiffure", "", "", "Aucun site", "", "", "", "", "", "", "", "", "", "", "", "Tulum"]),
  ].join("\r\n");
  const data = await readFile("gemini.csv", Buffer.from(csv, "utf8"));
  assert.equal(detectFormat(data.headers), "bedolt");
  const m = mappingFor("bedolt", data.headers);
  for (const f of ["nom", "telephone", "niche", "specialite", "zone", "lien_google_maps", "email", "site_web", "facebook", "instagram", "adresse", "ville"] as const) assert.ok(m[f] !== undefined, f);
  const items = analyze(data, m, { defaultVille: "Cancún" });
  const s = summarize(items);
  assert.equal(s.valid, 4);
  assert.deepEqual(s.newNiches, []);                                    // aucune niche créée sans choix explicite
  assert.equal(items[1].rec!.niche, "Beauté & coiffure");               // mot-clé « belleza » → niche du CRM
  assert.equal(items[1].rec!.specialite, "salon de belleza");           // la valeur d'origine est gardée
  assert.equal(items[2].rec!.niche, "");                                // « Tatoueurs » inconnue → sans niche…
  assert.equal(items[2].rec!.specialite, "Tatoueurs");                  // …mais gardée en spécialité
  assert.equal(items[0].rec!.specialite, "Coloration");
  assert.ok(s.nicheValues.some((v) => v.value === "Tatoueurs" && v.how === "none"));
  assert.equal(s.doubts, 1);
  assert.deepEqual(items[3].doubts, ["pas de lien Google Maps", "pas de téléphone"]);
  const r = commit(data, m, { defaultVille: "Cancún", fileName: "gemini.csv", format: "bedolt", onDuplicate: "ignore" });
  assert.equal(r.added, 4);
  assert.ok(!allNiches({ archived: true }).some((n) => n.label === "Tatoueurs"), "aucune niche créée");
  const b = db.prepare("SELECT * FROM businesses WHERE nom = 'Salón Luna'").get() as Record<string, unknown>;
  assert.equal(b.zone, "SM 22");                                          // « Notes » = quartier / colonia
  assert.equal(b.note_google, 4.6); assert.equal(b.nb_avis, 124);
  assert.equal(b.adresse, "Av. Tulum 12"); assert.equal(b.ville, "Cancún");
  assert.equal(b.email, "luna@gmail.com"); assert.equal(b.instagram, "https://www.instagram.com/salonluna");
  assert.equal(b.niche_id, allNiches().find((n) => n.label === "Beauté & coiffure")!.id);
  assert.deepEqual(db.prepare("SELECT niche_id, specialite FROM businesses WHERE nom = 'Tatuajes Maya'").get(), { niche_id: null, specialite: "Tatoueurs" });
  // Choix explicite dans l'aperçu : créer la niche « Tatoueurs » ou envoyer une valeur vers une niche existante
  db.exec("DELETE FROM businesses");
  const dent = allNiches().find((n) => n.label === "Dentistes")!;
  const r2 = commit(data, m, { defaultVille: "Cancún", fileName: "gemini.csv", format: "bedolt", onDuplicate: "ignore", nicheChoices: { tatoueurs: "new", "salon de belleza": dent.id } });
  assert.equal(r2.added, 4);
  const tat = allNiches().find((n) => n.label === "Tatoueurs");
  assert.ok(tat, "niche créée sur demande");
  assert.equal((db.prepare("SELECT niche_id FROM businesses WHERE nom = 'Tatuajes Maya'").get() as { niche_id: number }).niche_id, tat!.id);
  assert.equal((db.prepare("SELECT niche_id FROM businesses WHERE nom = 'Nails Sol'").get() as { niche_id: number }).niche_id, dent.id);
  assert.equal((db.prepare("SELECT site_web FROM businesses WHERE nom = 'Nails Sol'").get() as { site_web: string }).site_web, "https://nailssol.mx/");
  // Modèle CSV téléchargeable = même en-tête
  assert.ok(csvTemplate().replace(/^﻿/, "").startsWith(q(GEMINI_HEADERS)));
});

test("prompt Gemini : variables remplacées, format d'en-tête exact, valeurs de niche exactes", () => {
  const p = buildGeminiPrompt({ zone: "Cancún, Benito Juárez (Quintana Roo)", niches: [{ label: "Beauté & coiffure", keywords: ["salon de belleza", "unas"] }, { label: "Barbiers", keywords: [] }],
    nombre: 100, criteres: "sans site web en priorité, note ≥ 4", offre: "", message: "¡Hola {nom}! Vi su ficha en Google Maps." });
  assert.match(p, /Zone : Cancún, Benito Juárez \(Quintana Roo\) \(et uniquement cette zone\)\./);
  assert.match(p, /Types de commerces : Beauté & coiffure, Barbiers \(mots-clés de recherche : salon de belleza, unas, Barbiers\)\./);
  assert.match(p, /Nombre visé : 100 commerces différents\./);
  assert.match(p, /« Niche » : une de ces valeurs exactement : Beauté & coiffure \| Barbiers\. Rien d'autre/);
  assert.match(p, /« Spécialité » : le détail/);
  assert.match(p, /« Offre » : laisse vide\./);
  assert.match(p, /« Message WhatsApp » : ¡Hola \{nom\}! Vi su ficha en Google Maps\. \(remplace \{nom\} par le nom du commerce\)\./);
  assert.ok(p.includes("\n" + HEAD + "\n"));
});
