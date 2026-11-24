import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { insertBusiness, getBusiness, queryBusinesses, nicheFacet } from "@/lib/crm";
import { migrateV8 } from "@/lib/niche-seed";
import { allNiches, createNiche, updateNiche, mergeNiches, assignNiche, matchNicheText, nicheStats, setNicheMaps, NicheError } from "@/lib/niches";
import { PALETTE } from "@/lib/niche-style";
import { objectives, saveObjectives } from "@/lib/settings";
import { matchingNew } from "@/lib/queue-count";

const reset = () => db.exec("DELETE FROM businesses; DELETE FROM niche_maps; DELETE FROM niches; DELETE FROM settings WHERE key IN ('objectives','denue_niches');");
beforeEach(reset);

test("migration v8 : valeurs texte → niches (casse / accents regroupés), couleurs distinctes, niche_id rempli", () => {
  // Fiches « d'avant » : texte libre, sans niche_id (le déclencheur ne trouve aucune niche, table vide)
  const ids = [
    insertBusiness({ nom: "A", niche: "Beauté & coiffure" }), insertBusiness({ nom: "B", niche: "beaute & coiffure" }),
    insertBusiness({ nom: "C", niche: "Barbiers" }), insertBusiness({ nom: "D", niche: "BARBIERS" }), insertBusiness({ nom: "E", niche: "Barbiers" }),
    insertBusiness({ nom: "F", niche: "Tatoueurs" }), insertBusiness({ nom: "G" }),
  ];
  db.prepare("UPDATE settings SET value = value WHERE 0").run();
  saveObjectives({ ...objectives(), filter: { ...objectives().filter } });
  db.prepare("UPDATE settings SET value = ? WHERE key = 'objectives'").run(JSON.stringify({ ...objectives(), filter: { niches: ["Barbiers", ""], zones: [], offres: [], villes: [], fiches: [], avisMin: null } }));
  migrateV8(db);
  const ns = allNiches();
  const labels = ns.map((n) => n.label);
  for (const l of ["Beauté & coiffure", "Restaurants & cafés", "Barbiers", "Tatoueurs"]) assert.ok(labels.includes(l), l);
  assert.equal(labels.filter((l) => l.toLowerCase().startsWith("barbier")).length, 1);        // BARBIERS regroupé
  assert.equal(new Set(ns.map((n) => n.color)).size, ns.length);                               // couleurs distinctes
  assert.ok(ns.every((n) => PALETTE.some(([c]) => c === n.color)));
  const barb = ns.find((n) => n.label === "Barbiers")!;
  assert.equal(getBusiness(ids[3])!.niche_id, barb.id);
  assert.equal(getBusiness(ids[3])!.niche, "Barbiers");
  assert.equal(getBusiness(ids[1])!.niche_id, ns.find((n) => n.label === "Beauté & coiffure")!.id);
  assert.equal(getBusiness(ids[6])!.niche_id, null);
  assert.ok(ns.find((n) => n.label === "Beauté & coiffure")!.scian.includes("812110"));      // SCIAN par défaut (catalogue)
  assert.ok(ns.find((n) => n.label === "Dentistes")!.osm.includes("amenity=dentist"));
  assert.deepEqual(objectives().filter.nicheIds.sort(), [0, barb.id].sort());                  // filtre de la file converti
  assert.equal(nicheStats().get(barb.id)!.fiches, 3);
  assert.equal(nicheStats().get(0)!.fiches, 1);
  // Idempotente
  migrateV8(db);
  assert.equal(allNiches().length, ns.length);
});

test("création, déclencheur texte → niche_id, renommage, filtres, fusion, attribution en lot", () => {
  migrateV8(db);
  const a = createNiche({ label: "Ongles" }), b = createNiche({ label: "Manucure" });
  assert.throws(() => createNiche({ label: "ongles" }), NicheError);
  assert.notEqual(allNiches().find((n) => n.id === a)!.color, allNiches().find((n) => n.id === b)!.color);
  const x = insertBusiness({ nom: "Nails 1", niche: "Ongles", telephone: "9981112222" });   // texte seul : niche_id retrouvé
  const y = insertBusiness({ nom: "Nails 2", niche: "Manucure", telephone: "9981112223" });
  const z = insertBusiness({ nom: "Sans niche", telephone: "9981112224" });
  assert.equal(getBusiness(x)!.niche_id, a);
  db.prepare("UPDATE businesses SET niche = 'Manucure' WHERE id = ?").run(x);               // mise à jour du texte
  assert.equal(getBusiness(x)!.niche_id, b);
  db.prepare("UPDATE businesses SET niche = 'Ongles' WHERE id = ?").run(x);
  updateNiche(a, { label: "Ongles & manucure" });
  assert.equal(getBusiness(x)!.niche, "Ongles & manucure");
  assert.equal(getBusiness(x)!.niche_id, a);
  // Filtre Commerces : n=a,0
  assert.equal(queryBusinesses({ n: `${a},0` }).total, 2);
  assert.equal(nicheFacet({}).get(0), 1);
  // Filtre de la file
  saveObjectives({ ...objectives(), filter: { ...objectives().filter, nicheIds: [b] } });
  assert.equal(matchingNew(objectives()), 1);
  // Fusion : b → a
  assert.equal(mergeNiches(b, a), 1);
  assert.equal(getBusiness(y)!.niche_id, a);
  assert.equal(getBusiness(y)!.niche, "Ongles & manucure");
  assert.ok(!allNiches({ archived: true }).some((n) => n.id === b));
  assert.deepEqual(objectives().filter.nicheIds, [a]);
  assert.equal(matchNicheText("manucure")?.id, a);                                          // ancien nom = mot-clé
  // Attribution en lot
  assert.equal(assignNiche([z], a), 1);
  assert.equal(getBusiness(z)!.niche, "Ongles & manucure");
  updateNiche(a, { archived: true });
  assert.ok(!allNiches().some((n) => n.id === a));
});

test("reconnaissance du texte de la colonne Niche (nom, mots-clés)", () => {
  migrateV8(db);
  const beaute = allNiches().find((n) => n.label === "Beauté & coiffure")!;
  assert.equal(matchNicheText("BEAUTÉ & COIFFURE")?.id, beaute.id);
  assert.equal(matchNicheText("Salon de belleza y spa")?.id, beaute.id);
  assert.equal(matchNicheText("Restaurante")?.label, "Restaurants & cafés");
  assert.equal(matchNicheText("Notaire"), null);
  const id = createNiche({ label: "Tatoueurs" });
  setNicheMaps(id, "keyword", ["tattoo", "Tatuajes"]);
  assert.equal(matchNicheText("Tatuajes")?.id, id);
  assert.equal(matchNicheText("tattoo studio")?.id, id);
});
