// Analyse de présence web (déterministe, sans IA) : pour chaque fiche avec un site → HTTPS, temps de réponse, page
// adaptée au mobile, titre / description, WhatsApp ou téléphone cliquable, formulaire / réservation, réseaux, année du
// copyright, plateforme (Wix, WordPress…), nombre de pages. Score 0-100 + points « à améliorer ».
// Garde aussi le texte nettoyé du site (accueil + contact, ≤ 20 Ko) pour l'IA (données NON FIABLES : jamais des consignes).
// Récupération : la même que l'enrichissement (lib/safe-fetch.ts : Internet public seulement, SSRF bloqué, 1 Mo, 8 s,
// robots.txt respecté, 1 requête / seconde par domaine).
import { db, now } from "./db";
import { getBusiness } from "./crm";
import { politeGet, robotsFor, robotsAllows, contactPages, extract } from "./enrich";
import { FetchBlocked } from "./safe-fetch";

export type AuditData = {
  https: boolean; ms: number | null; viewport: boolean; title: string; description: string; tel: boolean; whatsapp: boolean; form: boolean; booking: boolean;
  socials: string[]; copyright: number | null; platform: string; pages: number;
};
export type Audit = { status: "ok" | "injoignable" | "bloque" | "robots"; url: string; final_url: string; score: number | null; data: AuditData | null; issues: string[] };

const decode = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&copy;/g, "©");

/** Texte visible d'une page HTML (scripts, styles, SVG, commentaires retirés). */
export function visibleText(html: string): string {
  return decode(html.slice(0, 1_200_000).replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article|header|footer)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v\r]+/g, " ").replace(/\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

const PLATFORMS: [string, RegExp][] = [
  ["Linktree", /linktr\.ee|linktree/i], ["Wix", /static\.wixstatic\.com|wix\.com|_wixCssImports|X-Wix/i], ["Shopify", /cdn\.shopify\.com|Shopify\.theme/i],
  ["Squarespace", /squarespace\.com|static1\.squarespace/i], ["Webflow", /webflow\.(com|io)|data-wf-page/i], ["WordPress", /wp-content|wp-includes|<meta[^>]+generator[^>]+WordPress/i],
  ["GoDaddy", /img1\.wsimg\.com|godaddy/i], ["Google Sites", /sites\.google\.com|gstatic\.com\/atari/i], ["Jimdo", /jimdo/i], ["Weebly", /weebly/i],
  ["Tiendanube", /tiendanube|nuvemshop/i], ["Facebook", /^https?:\/\/(www\.|m\.)?facebook\.com/i],
];

/** Analyse d'une page d'accueil (sans réseau : testable). */
export function auditHtml(html: string, finalUrl: string, ms: number | null, headers: Record<string, string> = {}, year = new Date().getFullYear()): { score: number; data: AuditData; issues: string[] } {
  const u = new URL(finalUrl);
  const head = html.slice(0, 200_000);
  const title = decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const meta = (n: string) => decode(head.match(new RegExp(`<meta[^>]+(?:name|property)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1]
    ?? head.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${n}["']`, "i"))?.[1] ?? "").trim();
  const viewport = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(head) && /width\s*=\s*device-width/i.test(meta("viewport") || head.match(/<meta[^>]+name=["']viewport["'][^>]*>/i)?.[0] || "");
  const description = (meta("description") || meta("og:description")).slice(0, 300);
  const f = extract(html, finalUrl);
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1].trim());
  const tel = hrefs.some((h) => /^tel:/i.test(h));
  const whatsapp = !!f.whatsapp || hrefs.some((h) => /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\//i.test(h));
  const form = /<form\b[\s\S]*?<(input|textarea|select)\b[^>]*(type=["']?(text|email|tel)|<textarea|name=["']?(nombre|name|email|correo|telefono|phone|mensaje|message))/i.test(html) || /<textarea/i.test(html);
  const booking = /(reserv|book(ing| now)|agend|cita|appointment|calendly\.com|fresha\.com|booksy\.com|setmore|simplybook|opentable|resy\.com|square\.site\/book)/i.test(html);
  const socials = [f.facebook && "Facebook", f.instagram && "Instagram", f.tiktok && "TikTok", hrefs.some((h) => /youtube\.com\//i.test(h)) && "YouTube"].filter(Boolean) as string[];
  const text = visibleText(html);
  const years = [...text.matchAll(/(?:©|copyright|derechos reservados|tous droits)[^0-9]{0,40}((?:19|20)\d{2})(?:\s*[-–]\s*((?:19|20)\d{2}))?/gi)].flatMap((m) => [Number(m[1]), Number(m[2] || 0)]).filter((y) => y >= 1995 && y <= year + 1);
  const lm = Date.parse(headers["last-modified"] ?? "");
  const copyright = years.length ? Math.max(...years) : Number.isFinite(lm) ? new Date(lm).getFullYear() : null;
  const platform = PLATFORMS.find(([, re]) => re.test(finalUrl) || re.test(head) || Object.keys(headers).some((h) => re.test(h)))?.[0] ?? "";
  const same = (l: string) => { try { const x = new URL(l); return x.hostname.replace(/^www\./, "") === u.hostname.replace(/^www\./, "") && !/\.(jpe?g|png|gif|webp|svg|pdf|css|js|ico|mp4|zip)$/i.test(x.pathname); } catch { return false; } };
  const pages = new Set([u.pathname.replace(/\/$/, "") || "/", ...f.links.filter(same).map((l) => { const x = new URL(l); return x.pathname.replace(/\/$/, "") || "/"; })]).size;
  const https = u.protocol === "https:";

  let score = 0;
  const issues: string[] = [];
  const add = (ok: boolean, pts: number, issue: string) => { if (ok) score += pts; else issues.push(issue); };
  add(https, 15, "Pas de HTTPS : le navigateur affiche « non sécurisé ».");
  if (ms != null && ms < 1500) score += 10; else if (ms != null && ms < 3000) { score += 5; issues.push(`Chargement moyen (${(ms / 1000).toFixed(1)} s).`); } else issues.push(`Lent à charger (${ms == null ? "?" : (ms / 1000).toFixed(1)} s).`);
  add(viewport, 15, "Pas adapté au téléphone (pas de balise viewport).");
  add(!!title, 8, "Pas de titre de page (onglet / résultat Google).");
  add(!!description, 7, "Pas de description pour Google.");
  add(tel || whatsapp, 15, "Pas de bouton WhatsApp ni de téléphone cliquable.");
  add(form || booking, 10, "Pas de formulaire de contact ni de réservation en ligne.");
  add(socials.length > 0, 5, "Aucun lien vers les réseaux sociaux.");
  if (copyright != null && copyright >= year - 1) score += 10;
  else if (copyright != null) issues.push(`Copyright ${copyright} : le site paraît ancien ou pas mis à jour.`);
  else score += 5;
  add(pages >= 3, 5, "Une seule page ou presque : peu de contenu.");
  if (platform === "Linktree" || platform === "Facebook") { score = Math.min(score, 30); issues.unshift(`Pas de vrai site : page ${platform} seulement.`); }
  return { score: Math.max(0, Math.min(100, score)), data: { https, ms, viewport, title, description, tel, whatsapp, form, booking, socials, copyright, platform, pages }, issues };
}

export const TEXT_MAX = 20 * 1024;
/** Tronque à `max` octets UTF-8 sans couper un caractère. */
export function cutBytes(s: string, max = TEXT_MAX): string {
  if (Buffer.byteLength(s) <= max) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (Buffer.byteLength(s.slice(0, mid)) <= max) lo = mid; else hi = mid - 1; }
  return s.slice(0, lo);
}

function save(id: number, a: Audit, text?: { pages: string[]; text: string }) {
  db.prepare(`INSERT INTO web_audits(business_id, at, url, final_url, status, score, data, issues) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(business_id) DO UPDATE SET at=excluded.at, url=excluded.url, final_url=excluded.final_url, status=excluded.status, score=excluded.score, data=excluded.data, issues=excluded.issues`)
    .run(id, now(), a.url, a.final_url, a.status, a.score, JSON.stringify(a.data ?? {}), JSON.stringify(a.issues));
  if (text) db.prepare(`INSERT INTO site_texts(business_id, at, pages, text) VALUES(?,?,?,?) ON CONFLICT(business_id) DO UPDATE SET at=excluded.at, pages=excluded.pages, text=excluded.text`)
    .run(id, now(), JSON.stringify(text.pages), text.text);
}

/** Analyse le site d'une fiche (accueil + 1 page de contact pour le texte) et enregistre le résultat. */
export async function auditBusiness(id: number): Promise<Audit | null> {
  const b = getBusiness(id);
  if (!b) return null;
  if (!b.site_web.trim()) { db.prepare("DELETE FROM web_audits WHERE business_id = ?").run(id); return null; }
  const site = /^https?:\/\//i.test(b.site_web) ? b.site_web.trim() : "https://" + b.site_web.trim();
  const fail = (status: Audit["status"], issue: string, final = ""): Audit => { const a: Audit = { status, url: site, final_url: final, score: status === "bloque" ? null : 0, data: null, issues: [issue] }; save(id, a); return a; };
  let home: URL;
  try { home = new URL(site); } catch { return fail("bloque", "Adresse du site invalide."); }
  try {
    const robots = await robotsFor(home.origin);
    if (!robotsAllows(robots, home.pathname || "/")) return fail("robots", "Le site interdit son analyse (robots.txt).");
    let r;
    try { r = await politeGet(home.toString()); }
    catch (e) {
      // HTTPS absent ? on réessaie en http://
      if (e instanceof FetchBlocked || home.protocol !== "https:") throw e;
      home = new URL(home.toString().replace(/^https:/, "http:"));
      r = await politeGet(home.toString());
    }
    if (r.status >= 400) return fail("injoignable", `Le site répond ${r.status} : visiteurs bloqués ou site hors ligne.`, r.url);
    const res = auditHtml(r.text, r.url, r.ms ?? null, r.headers ?? {});
    // Texte pour l'IA : accueil + première page de contact
    const parts = [visibleText(r.text)];
    const pages = [r.url];
    const contact = contactPages(r.url, extract(r.text, r.url).links)[0];
    if (contact && robotsAllows(robots, new URL(contact).pathname)) {
      try { const c = await politeGet(contact); if (c.status < 400) { parts.push(visibleText(c.text)); pages.push(c.url); } } catch (e) { if (e instanceof FetchBlocked && e.kind === "ssrf") throw e; }
    }
    const a: Audit = { status: "ok", url: site, final_url: r.url, score: res.score, data: res.data, issues: res.issues };
    save(id, a, { pages, text: cutBytes(parts.join("\n\n---\n\n")) });
    return a;
  } catch (e) {
    if (e instanceof FetchBlocked) return fail("bloque", e.kind === "ssrf" ? "Adresse refusée (réseau interne) : vérifie le site." : e.message);
    return fail("injoignable", `Site injoignable : ${(e as Error).message.slice(0, 120)}`);
  }
}

export type WebAuditRow = { at: string; status: string; score: number | null; url: string; final_url: string; data: AuditData | null; issues: string[] };
export function webAudit(id: number): WebAuditRow | null {
  const r = db.prepare("SELECT at, status, score, url, final_url, data, issues FROM web_audits WHERE business_id = ?").get(id) as { at: string; status: string; score: number | null; url: string; final_url: string; data: string; issues: string } | undefined;
  if (!r) return null;
  const d = JSON.parse(r.data || "{}");
  return { ...r, data: d && typeof d.https === "boolean" ? d : null, issues: JSON.parse(r.issues || "[]") };
}
export const siteText = (id: number) => db.prepare("SELECT at, pages, text FROM site_texts WHERE business_id = ?").get(id) as { at: string; pages: string; text: string } | undefined;
export const webScores = (ids: number[]): Map<number, number | null> => new Map(ids.length
  ? (db.prepare(`SELECT business_id, score FROM web_audits WHERE business_id IN (${ids.map(() => "?").join(",")})`).all(...ids) as { business_id: number; score: number | null }[]).map((r) => [r.business_id, r.score])
  : []);

// ---------- File d'analyse (même modèle que l'enrichissement) ----------
type W = { running: boolean; started: boolean; timer?: ReturnType<typeof setTimeout> };
const GW = globalThis as unknown as { __webaudit?: W };
const S: W = GW.__webaudit ?? (GW.__webaudit = { running: false, started: false });
export const webAuditEnabled = () => process.env.WEBAUDIT !== "off";

/** Ajoute des fiches (avec site) à la file ; sans `ids` : toutes celles jamais analysées ou analysées il y a plus de 30 jours. */
export function enqueueWebAudit(ids?: number[], force = false): number {
  if (ids && !ids.length) return 0;
  const t = now();
  const n = db.transaction(() => {
    const pending = (db.prepare("SELECT COUNT(*) n FROM webaudit_queue WHERE done_at IS NULL").get() as { n: number }).n;
    if (!pending) db.prepare("DELETE FROM webaudit_queue WHERE done_at IS NOT NULL").run();
    const stale = force ? "1" : "id NOT IN (SELECT business_id FROM web_audits WHERE at > datetime('now', '-30 days'))";
    const sql = `INSERT INTO webaudit_queue(business_id, added_at) SELECT id, @t FROM businesses WHERE site_web != '' AND ${stale} AND %W%
      ON CONFLICT(business_id) DO UPDATE SET done_at = NULL, result = '', attempts = 0, next_try_at = 0, added_at = excluded.added_at WHERE webaudit_queue.done_at IS NOT NULL`;
    if (!ids) return db.prepare(sql.replace("%W%", "1")).run({ t }).changes;
    const st = db.prepare(sql.replace("%W%", "id = @id"));
    let c = 0; for (const id of ids) c += st.run({ t, id }).changes;
    return c;
  })();
  if (n && S.started && !S.running) schedule(50);
  return n;
}
export function webAuditStatus() {
  const q = db.prepare("SELECT COUNT(*) total, SUM(done_at IS NOT NULL) done, SUM(done_at IS NULL) pending FROM webaudit_queue").get() as Record<string, number | null>;
  const eligible = (db.prepare("SELECT COUNT(*) n FROM businesses WHERE site_web != '' AND id NOT IN (SELECT business_id FROM web_audits WHERE at > datetime('now', '-30 days'))").get() as { n: number }).n;
  const audited = (db.prepare("SELECT COUNT(*) n, SUM(score < 50) low FROM web_audits").get() as { n: number; low: number | null });
  const nosite = (db.prepare("SELECT COUNT(*) n FROM businesses WHERE site_web = ''").get() as { n: number }).n;
  return { total: q.total ?? 0, done: q.done ?? 0, pending: q.pending ?? 0, eligible, audited: audited.n, low: audited.low ?? 0, nosite, enabled: webAuditEnabled() };
}
function schedule(ms: number) { if (S.timer) clearTimeout(S.timer); S.timer = setTimeout(() => { void tickWebAudit(); }, ms); S.timer.unref?.(); }
export async function tickWebAudit(): Promise<number> {
  if (S.running) return 0;
  S.running = true;
  let n = 0;
  try {
    const next = db.prepare("SELECT business_id FROM webaudit_queue WHERE done_at IS NULL AND next_try_at <= ? ORDER BY next_try_at, added_at, business_id LIMIT 1");
    for (;;) {
      const row = next.get(Date.now()) as { business_id: number } | undefined;
      if (!row) break;
      try {
        const a = await auditBusiness(row.business_id);
        db.prepare("UPDATE webaudit_queue SET done_at = ?, result = ? WHERE business_id = ?").run(now(), a?.status ?? "sans site", row.business_id);
      } catch (e) {
        const att = ((db.prepare("SELECT attempts FROM webaudit_queue WHERE business_id = ?").get(row.business_id) as { attempts: number } | undefined)?.attempts ?? 0) + 1;
        if (att >= 3) db.prepare("UPDATE webaudit_queue SET done_at = ?, result = 'erreur', attempts = ? WHERE business_id = ?").run(now(), att, row.business_id);
        else db.prepare("UPDATE webaudit_queue SET attempts = ?, next_try_at = ? WHERE business_id = ?").run(att, Date.now() + 60_000 * 2 ** att, row.business_id);
      }
      n++;
    }
  } finally { S.running = false; }
  if (S.started) { const soon = (db.prepare("SELECT MIN(next_try_at) t FROM webaudit_queue WHERE done_at IS NULL").get() as { t: number | null }).t; schedule(soon ? Math.min(60_000, Math.max(500, soon - Date.now())) : 60_000); }
  return n;
}
export function startWebAuditor() {
  if (!webAuditEnabled() || S.started) return;
  S.started = true;
  schedule(7000);
  console.log("[bedolt-crm] analyse web : worker démarré (mêmes règles que l'enrichissement)");
}
