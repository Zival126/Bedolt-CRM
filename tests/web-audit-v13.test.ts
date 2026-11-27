// Analyse web v13 : redirections (5 max, revérifiées SSRF), délai total 20 s, 1 nouvel essai, URL finale et « Mettre à
// jour le site de la fiche », site injoignable = « à vérifier » (pas de score 0), contenu suspect, infos clés pour l'IA.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { insertBusiness, getBusiness, queryBusinesses, businessActions } from "@/lib/crm";
import { auditBusiness, webAudit, useFinalSite, suspectContent, branchCount, auditHtml, webScores, AUDIT_TOTAL_MS, AUDIT_REDIRECTS } from "@/lib/web-audit";
import { setEnrichDeps } from "@/lib/enrich";
import { safeGet, FetchFailed, type Transport } from "@/lib/safe-fetch";
import { getAiContext } from "@/lib/ai-context";
import { buildAnalyseMessages, webSummary } from "@/lib/ai-prompt";

beforeEach(() => db.exec("DELETE FROM businesses; DELETE FROM web_audits; DELETE FROM site_texts; DELETE FROM http_cache;"));
after(() => setEnrichDeps({}));

const page = (html: string, status = 200, headers: Record<string, string> = {}): Awaited<ReturnType<Transport>> =>
  ({ status, headers: { "content-type": "text/html; charset=utf-8", ...headers }, body: Buffer.from(html), truncated: false });
const redirect = (to: string) => page("", 301, { location: to });
const GOOD = `<html><head><title>Salón Luna</title><meta name="viewport" content="width=device-width"><meta name="description" content="Uñas en Cancún"></head>
<body><a href="https://wa.me/5299">WhatsApp</a><a href="https://www.fresha.com/book/luna">Reservar</a><p>Contamos con 3 sucursales en Cancún.</p><footer>© 2026</footer></body></html>`;
const deps = (transport: Transport, resolve: (h: string) => Promise<string[]> = async () => ["93.184.216.34"]) => {
  const sleeps: number[] = [];
  setEnrichDeps({ resolve, perDomainMs: 0, sleep: async (ms) => { sleeps.push(ms); }, transport: async (ip, url, o) => (url.pathname === "/robots.txt" ? page("", 404) : transport(ip, url, o)) });
  return sleeps;
};

test("redirections : jusqu'à 5 sauts suivis (URL finale enregistrée), 6 = « à vérifier » ; chaque saut revérifié (SSRF)", async () => {
  assert.deepEqual([AUDIT_TOTAL_MS, AUDIT_REDIRECTS], [20_000, 5]);
  const id = insertBusiness({ nom: "Salón Luna", site_web: "salonluna.mx", telephone: "9981112233", niche: "Beauté" });
  deps(async (_ip, url) => {
    const n = Number(url.searchParams.get("n") ?? 0);
    if (url.hostname === "salonluna.mx" && n < 4) return redirect(`https://salonluna.mx/?n=${n + 1}`);
    if (url.hostname === "salonluna.mx") return redirect("https://www.luna-nails.com/inicio");
    return page(GOOD);
  });
  const a = await auditBusiness(id);
  assert.equal(a!.status, "ok");
  const w = webAudit(id)!;
  assert.equal(w.final_url, "https://www.luna-nails.com/inicio");
  assert.deepEqual([w.domainChanged, w.finalSite], [true, "https://www.luna-nails.com/inicio"]);
  assert.ok(w.issues.some((x) => /autre domaine \(luna-nails\.com\)/.test(x)));
  // « Mettre à jour le site de la fiche » : seulement sur clic, journalisé
  assert.equal(getBusiness(id)!.site_web, "salonluna.mx");
  assert.equal(useFinalSite(id), "https://www.luna-nails.com/inicio");
  assert.equal(getBusiness(id)!.site_web, "https://www.luna-nails.com/inicio");
  assert.match(businessActions(id)[0].content, /Site web mis à jour : salonluna\.mx → https:\/\/www\.luna-nails\.com\/inicio/);
  assert.equal(webAudit(id)!.domainChanged, false);
  assert.equal(useFinalSite(id), null);
  // 6 redirections : abandon, statut « à vérifier », pas de score
  const loop = insertBusiness({ nom: "Bucle", site_web: "https://bucle.mx", telephone: "9981112234" });
  deps(async (_ip, url) => redirect(`https://bucle.mx/?n=${Number(url.searchParams.get("n") ?? 0) + 1}`));
  const b = await auditBusiness(loop);
  assert.deepEqual([b!.status, b!.score], ["injoignable", null]);
  assert.match(b!.issues[0], /Trop de redirections \(plus de 5\).*à vérifier/);
  // Une redirection vers une adresse interne est bloquée au saut concerné (jamais contactée)
  const evil = insertBusiness({ nom: "Piège", site_web: "https://piege.mx", telephone: "9981112235" });
  const hit: string[] = [];
  deps(async (_ip, url) => { hit.push(url.hostname); return url.hostname === "piege.mx" ? redirect("http://interne.piege.mx/") : page(GOOD); },
    async (h) => (h === "interne.piege.mx" ? ["10.0.0.7"] : ["93.184.216.34"]));
  const e = await auditBusiness(evil);
  assert.deepEqual([e!.status, e!.score, hit.includes("interne.piege.mx")], ["bloque", null, false]);
});

test("délai TOTAL (redirections comprises) et 1 nouvel essai", async () => {
  // safeGet : le temps restant diminue à chaque saut ; dépassé → erreur claire
  const budgets: number[] = [];
  const slow: Transport = async (_ip, url, o) => { budgets.push(o.timeoutMs); await new Promise((r) => setTimeout(r, 60)); return redirect(`/p${Number(url.pathname.slice(2) || 0) + 1}`); };
  await assert.rejects(safeGet("https://lent.mx/", { resolve: async () => ["93.184.216.34"], transport: slow, totalMs: 150, maxRedirects: 5 }), /Délai dépassé/);
  assert.ok(budgets.length >= 2 && budgets[0] <= 150 && budgets[1] < budgets[0], JSON.stringify(budgets));
  // Analyse : 1er essai en échec (site qui ne répond pas), 2e essai réussi après une pause
  const id = insertBusiness({ nom: "Lento", site_web: "https://lento.mx", telephone: "9981112236" });
  let calls = 0;
  const sleeps = deps(async () => { calls++; if (calls === 1) throw new FetchFailed("Délai dépassé (20 s au total)."); return page(GOOD); });
  const a = await auditBusiness(id);
  assert.deepEqual([a!.status, calls >= 2, sleeps.includes(3000)], ["ok", true, true]);
  // Erreur 5xx puis OK : aussi un nouvel essai
  const id2 = insertBusiness({ nom: "Error500", site_web: "https://e500.mx", telephone: "9981112237" });
  let n2 = 0;
  deps(async () => (++n2 === 1 ? page("down", 503) : page(GOOD)));
  assert.equal((await auditBusiness(id2))!.status, "ok");
});

test("site injoignable : statut « à vérifier », score VIDE (pas 0), distinct de « aucun site » ; l'IA reçoit ce statut", async () => {
  const id = insertBusiness({ nom: "Caído", site_web: "https://caido.mx", telephone: "9981112238" });
  const sleeps = deps(async () => { throw new FetchFailed("Site injoignable (ECONNREFUSED)."); });
  const a = await auditBusiness(id);
  assert.deepEqual([a!.status, a!.score], ["injoignable", null]);
  assert.match(a!.issues[0], /après 2 essais.*À vérifier/);
  assert.equal(sleeps.filter((x) => x === 3000).length >= 1, true);
  assert.equal(webAudit(id)!.score, null);
  assert.deepEqual(webScores([id]).get(id), { score: null, status: "injoignable" });
  // Ni « site faible (< 50) » ni « aucun site »
  insertBusiness({ nom: "Sin sitio", telephone: "9981112239" });
  assert.equal(queryBusinesses({ webscore: "lt50" }).total, 0);
  assert.equal(queryBusinesses({ webscore: "nosite" }).total, 1);
  // Dossier IA : statut explicite, pas de score
  const w = getAiContext(id)!.web as { statut: string; score: null; a_verifier: boolean };
  assert.deepEqual([w.statut, w.score, w.a_verifier], ["injoignable_a_verifier", null, true]);
  const [sys, user] = buildAnalyseMessages(getAiContext(id)!, { contextTokens: 6000 });
  assert.match(user.content, /<presence_web>site https:\/\/caido\.mx : À VÉRIFIER[^<]*pas de score<\/presence_web>/);
  assert.match(sys.content, /« à vérifier »[^\n]*INCONNU/);
  assert.ok(!/score web 0/.test(user.content));
  // Ancienne base : un ancien « 0 » d'un site injoignable est remis à vide par la migration v13
  db.prepare("UPDATE web_audits SET score = 0 WHERE business_id = ?").run(id);
  assert.equal(webAudit(id)!.score, null, "jamais affiché comme 0");
});

test("contenu suspect sans rapport avec l'activité → « site possiblement piraté » ; activité correspondante = normal", () => {
  const spam = GOOD.replace("</body>", '<div style="display:none">Slot gacor hari ini, situs slot gacor terpercaya, judi online <a href="https://x.top/slot88">slot88</a></div></body>');
  const r = auditHtml(spam, "https://salonluna.mx/", 500, {}, 2026, "Beauté Salón de uñas");
  assert.deepEqual(r.data.suspect, ["casino / paris"]);
  assert.match(r.issues[0], /Contenu suspect sans rapport avec l'activité \(casino \/ paris\) : site possiblement piraté/);
  assert.ok(r.score <= 30);
  assert.deepEqual(auditHtml(GOOD, "https://salonluna.mx/", 500, {}, 2026, "Beauté").data.suspect, []);
  // Une vraie pharmacie qui parle de « farmacia en línea » n'est pas suspecte ; un salon, si
  const pharma = "Farmacia en línea con envío. Viagra y Cialis con receta. Farmacia online 24 h.";
  assert.deepEqual(suspectContent(pharma, "", [], "Farmacia San Pablo"), []);
  assert.deepEqual(suspectContent(pharma, "", [], "Salón de uñas"), ["pharmacie en ligne"]);
  // Un seul mot isolé (« aceptamos bitcoin ») ne suffit pas ; dans le titre, si
  assert.deepEqual(suspectContent("Aceptamos bitcoin como pago.", "Taller", [], "Garage"), []);
  assert.deepEqual(suspectContent("", "Buy Viagra cheap", [], "Garage"), ["pharmacie en ligne"]);
  assert.equal(branchCount("Visítanos en nuestras 4 sucursales"), 4);
  assert.equal(branchCount("Abrimos 1 local"), null);
});

test("l'IA reçoit les infos clés de l'analyse web (score, plateforme, WhatsApp, réservation, établissements)", async () => {
  const id = insertBusiness({ nom: "Luna", site_web: "https://salonluna.mx", telephone: "9981112240" });
  deps(async () => page(GOOD.replace("<head>", '<head><link href="https://static.wixstatic.com/a.css">')));
  await auditBusiness(id);
  const ctx = getAiContext(id)!;
  const w = ctx.web as { statut: string; etablissements: number; whatsapp: boolean; reservation: boolean; plateforme: string };
  assert.deepEqual([w.statut, w.etablissements, w.whatsapp, w.reservation, w.plateforme], ["ok", 3, true, true, "Wix"]);
  const s = webSummary(ctx);
  for (const re of [/score web \d+\/100/, /plateforme Wix/, /WhatsApp oui/, /réservation en ligne oui/, /3 établissements/]) assert.match(s, re);
  const [sys, user] = buildAnalyseMessages(ctx, { contextTokens: 1200 });   // contexte minuscule : le résumé web reste
  assert.ok(user.content.includes(`<presence_web>${s}</presence_web>`));
  assert.match(sys.content, /déjà bien équipé[^\n]*priorité plus BASSE/);
});
