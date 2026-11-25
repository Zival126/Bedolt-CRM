import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { db } from "@/lib/db";
import { insertBusiness, getBusiness, queryBusinesses } from "@/lib/crm";
import { createNiche, allNiches, setNicheMaps, matchNicheText, nicheStats } from "@/lib/niches";
import { classifyText, SURE } from "@/lib/niche-classify";
import { buildPlan, applyRegroup, undoRegroup, lastRegroup, defaultMains } from "@/lib/niche-regroup";
import { backupNow } from "@/lib/backup-now";
import { objectives, saveObjectives } from "@/lib/settings";
import { readFile, mappingFor, analyze, commit } from "@/lib/import";

beforeEach(() => db.exec("DELETE FROM businesses; DELETE FROM niche_maps; DELETE FROM niches; DELETE FROM niche_regroup_items; DELETE FROM niche_regroups;"));

test("classement par mots-clés FR / ES : premier mot significatif, expressions, mots décisifs", () => {
  const k = (t: string) => classifyText(t).key;
  assert.equal(k("Urgences vétérinaires 24h & Chirurgie"), "veto");
  assert.equal(k("Orthodontie & Esthétique dentaire"), "dentistes");
  assert.equal(k("Barbier & Grooming"), "barbiers");
  assert.equal(k("Suspension, rotules & Amortisseurs"), "auto");
  assert.equal(k("Serrurerie 24h & Dépannage"), "depannage");
  assert.equal(k("Estética canina"), "veto");                 // l'expression l'emporte sur « estética »
  assert.equal(k("Médecine féline"), "veto");                 // mot décisif (animal)
  assert.equal(k("Renta de motos"), "location");              // pas « Mécanique & auto »
  assert.equal(k("Auto-école"), "services");
  assert.equal(k("Pastel de boda"), "evenements");
  assert.equal(k("Tacos al pastor"), "restaurants");
  assert.equal(k("Uñas acrílicas"), "ongles");
  assert.equal(k("Marketing digital"), null);
  assert.equal(classifyText("Dentistes").confidence, 100);
  assert.ok(classifyText("Clinique 24h").confidence < SURE);  // seulement des mots génériques : incertain
});

test("regroupement : proposition, application (spécialité, mots-clés, correspondances, filtres), annulation", async () => {
  const mk = (label: string, n: number, extra: Record<string, unknown> = {}) => {
    const id = createNiche({ label });
    const ids = Array.from({ length: n }, (_, i) => insertBusiness({ nom: `${label} ${i}`, niche: label, telephone: String(9981000000 + Math.floor(Math.random() * 999999)), ...extra }));
    return { id, ids };
  };
  const dent = mk("Dentistes", 25), sdp = mk("Salles de sport", 22), auto = mk("Auto moto et pneus", 21), danse = mk("Sport danse et musique", 4);
  const ortho = mk("Orthodontie & Esthétique dentaire", 2), vet = mk("Urgences vétérinaires 24h & Chirurgie", 1), barb = mk("Barbier & Grooming", 3);
  const susp = mk("Suspension, rotules & Amortisseurs", 2), serr = mk("Serrurerie 24h & Dépannage", 1), flou = mk("Négoce en ligne", 2);
  // Sans mot-clé, mais fiches DENUE d'une classe de salons de belleza (812110) → proposée par l'activité des fiches
  const myst = mk("Studio Luna", 3, { denue_id: "23005812110100001" });
  db.prepare("UPDATE businesses SET denue_id = '23005812110' || id WHERE niche_id = ?").run(myst.id);
  setNicheMaps(auto.id, "osm", ["shop=car_repair"]);
  db.prepare("UPDATE businesses SET specialite = 'Déjà renseignée' WHERE id = ?").run(ortho.ids[0]);
  saveObjectives({ ...objectives(), filter: { ...objectives().filter, nicheIds: [vet.id, flou.id] } });

  const plan = buildPlan();
  const t = (id: number) => plan.rows.find((r) => r.id === id)!;
  assert.equal(t(ortho.id).target, "dentistes");
  assert.equal(t(vet.id).target, "veto");
  assert.equal(t(barb.id).target, "barbiers");
  assert.equal(t(susp.id).target, "auto");
  assert.equal(t(serr.id).target, "depannage");
  assert.equal(t(auto.id).target, "auto");
  assert.equal(t(danse.id).target, "sport");
  assert.equal(t(flou.id).target, "none");
  assert.equal(t(myst.id).target, "beaute");
  assert.match(t(myst.id).reason, /activité des fiches/);
  assert.ok(t(dent.id).main && t(sdp.id).target === "sport");

  // Sauvegarde juste avant (BACKUP_DIR)
  const file = await backupNow("preregroup");
  assert.ok(fs.existsSync(`${process.env.BACKUP_DIR}/${file}`));
  const assign = Object.fromEntries(plan.rows.map((r) => [r.id, r.target]));
  const r = applyRegroup(defaultMains(), assign, file);
  assert.equal(r.noNiche, 2);
  const after = allNiches({ archived: true });
  const L = (l: string) => after.find((n) => n.label === l)!;
  assert.ok(L("Mécanique & auto") && L("Salles de sport & studios") && L("Dentistes") && L("Barbiers"));
  assert.equal(after.length, 17);                                                     // les 17 niches principales
  assert.equal(L("Salles de sport & studios").id, sdp.id);                            // la grosse niche est gardée (couleur, id)
  assert.equal(L("Mécanique & auto").id, auto.id);
  assert.ok(L("Mécanique & auto").osm.includes("shop=car_repair"));                   // correspondances conservées
  // Fiches : niche principale + ancien libellé en spécialité (sauf si déjà rempli)
  assert.deepEqual([getBusiness(susp.ids[0])!.niche, getBusiness(susp.ids[0])!.specialite], ["Mécanique & auto", "Suspension, rotules & Amortisseurs"]);
  assert.equal(getBusiness(ortho.ids[0])!.specialite, "Déjà renseignée");
  assert.equal(getBusiness(ortho.ids[1])!.niche_id, dent.id);
  assert.equal(getBusiness(danse.ids[0])!.niche, "Salles de sport & studios");
  assert.equal(getBusiness(sdp.ids[0])!.specialite, "");                              // niche gardée : pas de spécialité ajoutée
  assert.deepEqual([getBusiness(flou.ids[0])!.niche_id, getBusiness(flou.ids[0])!.specialite], [null, "Négoce en ligne"]);
  // Ancien libellé = mot-clé de la cible ; filtre de la file remappé ; recherche par spécialité
  assert.equal(matchNicheText("Urgences vétérinaires 24h & Chirurgie")?.label, "Vétérinaires & animaux");
  assert.deepEqual(objectives().filter.nicheIds, [L("Vétérinaires & animaux").id]);
  assert.equal(queryBusinesses({ q: "Amortisseurs" }).total, 2);
  assert.equal(nicheStats().get(0)?.fiches, 2);

  // Import après regroupement : valeur inconnue classée vers une niche principale, jamais créée
  const csv = "Entreprise,Téléphone,Statut,Niche,Offre,Présence web,Angle,Notes,Note Google,Avis,Lien Google Maps,Message WhatsApp\n" +
    '"Frenos Pérez","+52 998 555 0001","À contacter","Frenos ABS y discos","","","","","","","",""\n"Agencia X","+52 998 555 0002","À contacter","Consultoría","","","","","","","",""';
  const data = await readFile("x.csv", Buffer.from(csv));
  const n0 = allNiches({ archived: true }).length;
  commit(data, mappingFor("bedolt", data.headers), { defaultVille: "Cancún", fileName: "x.csv", format: "bedolt", onDuplicate: "ignore" });
  assert.equal(allNiches({ archived: true }).length, n0);
  assert.deepEqual(db.prepare("SELECT niche, specialite FROM businesses WHERE nom = 'Frenos Pérez'").get(), { niche: "Mécanique & auto", specialite: "Frenos ABS y discos" });
  assert.deepEqual(db.prepare("SELECT niche_id, specialite FROM businesses WHERE nom = 'Agencia X'").get(), { niche_id: null, specialite: "Consultoría" });
  assert.deepEqual(analyze(data, mappingFor("bedolt", data.headers), { defaultVille: "" }).map((x) => x.nicheHow), ["classe", "none"]);

  // Annulation : tout revient comme avant
  assert.ok(lastRegroup()!.canUndo);
  undoRegroup();
  const back = allNiches({ archived: true });
  assert.equal(back.length, 11);
  assert.ok(back.some((n) => n.label === "Auto moto et pneus" && n.id === auto.id));
  assert.deepEqual([getBusiness(susp.ids[0])!.niche_id, getBusiness(susp.ids[0])!.niche, getBusiness(susp.ids[0])!.specialite], [susp.id, "Suspension, rotules & Amortisseurs", ""]);
  assert.equal(getBusiness(sdp.ids[0])!.niche, "Salles de sport");
  assert.deepEqual(getBusiness(flou.ids[0])!.niche_id, flou.id);
  assert.deepEqual(objectives().filter.nicheIds, [vet.id, flou.id]);
  // Fiche importée après le regroupement : reste dans la niche gardée, qui reprend son ancien nom
  assert.deepEqual(db.prepare("SELECT niche_id, niche FROM businesses WHERE nom = 'Frenos Pérez'").get(), { niche_id: auto.id, niche: "Auto moto et pneus" });
  assert.throws(() => undoRegroup(), /déjà annulé/);

  // Une autre opération de niches après un regroupement empêche son annulation
  applyRegroup(defaultMains(), Object.fromEntries(buildPlan().rows.map((x) => [x.id, x.target])));
  createNiche({ label: "Hôtels" });
  assert.equal(lastRegroup()!.canUndo, false);
  assert.throws(() => undoRegroup(), /autres modifications/);
});
