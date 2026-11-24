// Enrichissement automatique depuis le site web d'une fiche : emails, Facebook / Instagram / TikTok, WhatsApp (wa.me).
// Page d'accueil + au plus 2 pages de contact évidentes ; robots.txt respecté ; 1 requête / seconde par domaine ;
// seuls les champs VIDES sont remplis, avec l'origine (« email trouvé sur sitio.com/contacto le … »).
// Jamais de changement de statut ni du drapeau « ne pas contacter ».
import { db, now, today } from "./db";
import { telNorm, waNumber } from "./phone";
import { getBusiness } from "./crm";
import { recordOrigin } from "./sources";
import { enrichHooks } from "./enrich-queue";
import { safeGet, FetchBlocked, UA, type Resolver, type Transport, type SafeResponse } from "./safe-fetch";

export { enqueueEnrich, enrichStatus } from "./enrich-queue";

// ---------- Extraction ----------
const IGNORED_EMAIL = [
  /@(example|ejemplo|domain|dominio|email|correo|yoursite|tusitio|mysite|sitio)\.(com|mx|org)$/i,
  /@(sentry|sentry-next|wixpress|wix|godaddy|squarespace|shopify|wordpress|mailchimp|hubspot|cloudflare|googlemail\.example)\./i,
  /@[\w.-]*sentry\.io$/i, /^(noreply|no-reply|donotreply|mailer-daemon|postmaster|abuse|webmaster|user|usuario|nombre|name|test|tu|you|your)@/i,
  /\.(png|jpe?g|gif|webp|svg|css|js)$/i, /@\d+x\./i, /^[0-9a-f]{20,}@/i,
];
export const usefulEmail = (e: string) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(e) && e.length <= 100 && !IGNORED_EMAIL.some((re) => re.test(e));

const decodeEntities = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#64;|&commat;/g, "@").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");

/** Cloudflare « email protection » : data-cfemail="hex" (XOR avec le 1er octet). */
function cfDecode(hex: string): string {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4) return "";
  const k = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k);
  return out;
}

export type Found = { emails: string[]; facebook: string; instagram: string; tiktok: string; whatsapp: string; links: string[] };

/** Analyse une page HTML (aucun script exécuté) : emails, réseaux, WhatsApp, liens internes. */
export function extract(html: string, pageUrl: string): Found {
  const raw = html.slice(0, 1_200_000);
  const text = decodeEntities(raw);
  const emails = new Set<string>();
  for (const m of text.matchAll(/mailto:([^"'?\s>]+)/gi)) { try { emails.add(decodeURIComponent(m[1]).toLowerCase()); } catch { emails.add(m[1].toLowerCase()); } }
  for (const m of raw.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) { const e = cfDecode(m[1]); if (e) emails.add(e.toLowerCase()); }
  const visible = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/\s*(\[at\]|\(at\)|\s+arroba\s+)\s*/gi, "@");
  for (const m of visible.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) emails.add(m[0].toLowerCase().replace(/\.$/, ""));
  const hrefs = [...text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1].trim());
  const abs = (h: string) => { try { return new URL(h, pageUrl).toString(); } catch { return ""; } };
  const social = (re: RegExp, bad: RegExp) => {
    for (const h of hrefs) { const u = abs(h); if (re.test(u) && !bad.test(u)) return u.split("?")[0].replace(/\/$/, ""); }
    return "";
  };
  const facebook = social(/^https?:\/\/(www\.|m\.|web\.)?(facebook|fb)\.com\/[^/]+/i, /\/(sharer|share|plugins|dialog|tr|login|groups\/?$|events|policies|privacy)/i);
  const instagram = social(/^https?:\/\/(www\.)?instagram\.com\/[\w.]+/i, /\/(p|reel|explore|accounts|stories)\//i);
  const tiktok = social(/^https?:\/\/(www\.)?tiktok\.com\/@[\w.]+/i, /\/video\//i);
  let whatsapp = "";
  for (const h of [...hrefs, ...text.matchAll(/(?:wa\.me|api\.whatsapp\.com\/send|whatsapp:\/\/send)[^"'\s<]*/gi)].map((x) => (typeof x === "string" ? x : x[0]))) {
    const m = h.match(/wa\.me\/\+?(\d{8,15})/i) ?? h.match(/[?&](?:amp;)?phone=\+?(\d{8,15})/i);
    if (m && /wa\.me|whatsapp/i.test(h)) { whatsapp = m[1]; break; }
  }
  const links = hrefs.map(abs).filter(Boolean);
  return { emails: [...emails].filter(usefulEmail), facebook, instagram, tiktok, whatsapp, links };
}

const CONTACT_RE = /\/(contact[oa]?|contactanos|contact-us|contactenos|nosotros|about|acerca|quienes-somos|ubicacion|sucursales)(\/|\.html?|\.php)?$/i;
/** Pages de contact évidentes, même site, 2 maximum (liens de la page d'accueil, sinon /contacto et /contact). */
export function contactPages(home: string, links: string[]): string[] {
  const h = new URL(home);
  const same = (u: string) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, "") === h.hostname.replace(/^www\./, "") && /^https?:$/.test(x.protocol); } catch { return false; } };
  const found = [...new Set(links.filter((l) => same(l) && CONTACT_RE.test(new URL(l).pathname)).map((l) => l.split("#")[0]))];
  const pick = found.sort((a, b) => Number(/contact/i.test(b)) - Number(/contact/i.test(a))).slice(0, 2);
  if (pick.length) return pick;
  return ["/contacto", "/contact"].map((p) => new URL(p, h.origin).toString());
}

// ---------- robots.txt ----------
/** Règles robots.txt applicables (groupe BedoltCRM s'il existe, sinon *). */
export function robotsAllows(robots: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null, lastWasAgent = false;
  for (const line of robots.split(/\r?\n/)) {
    const m = line.replace(/#.*/, "").trim().match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [k, v] = [m[1].toLowerCase(), m[2].trim()];
    if (k === "user-agent") { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; }
    else { lastWasAgent = false; if (cur && (k === "allow" || k === "disallow")) cur.rules.push({ allow: k === "allow", path: v }); }
  }
  const g = groups.find((x) => x.agents.some((a) => a !== "*" && "bedoltcrm".includes(a))) ?? groups.find((x) => x.agents.includes("*"));
  if (!g) return true;
  let best: { allow: boolean; len: number } | null = null;
  for (const r of g.rules) {
    if (!r.path) continue;                                       // « Disallow: » vide = tout autorisé
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
  }
  return best ? best.allow : true;
}

// ---------- Récupération polie ----------
type Deps = { resolve?: Resolver; transport?: Transport; sleep?: (ms: number) => Promise<void>; perDomainMs?: number };
type EState = { deps: Deps; last: Map<string, number>; running: boolean; started: boolean; timer?: ReturnType<typeof setTimeout> };
const G = globalThis as unknown as { __enrich?: EState };
const E: EState = G.__enrich ?? (G.__enrich = { deps: {}, last: new Map<string, number>(), running: false, started: false });
/** Tests : DNS / transport simulés. */
export function setEnrichDeps(d: Deps) { E.deps = d; E.last.clear(); }
const sleep = (ms: number) => (E.deps.sleep ?? ((x: number) => new Promise((r) => setTimeout(r, x))))(ms);

async function politeGet(url: string): Promise<SafeResponse> {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const gap = E.deps.perDomainMs ?? 1000;
  const wait = (E.last.get(host) ?? 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  E.last.set(host, Date.now());
  return safeGet(url, { resolve: E.deps.resolve, transport: E.deps.transport });
}

async function robotsFor(origin: string): Promise<string> {
  const k = "robots:" + origin;
  const c = db.prepare("SELECT body, at FROM http_cache WHERE k = ?").get(k) as { body: string; at: number } | undefined;
  if (c && Date.now() - c.at < 24 * 3600_000) return c.body;
  let body = "";
  try { const r = await politeGet(origin + "/robots.txt"); body = r.status === 200 && !/<html/i.test(r.text.slice(0, 200)) ? r.text.slice(0, 100_000) : ""; }
  catch (e) { if (e instanceof FetchBlocked && e.kind !== "type") throw e; body = ""; }
  db.prepare("INSERT INTO http_cache(k, body, at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET body=excluded.body, at=excluded.at").run(k, body, Date.now());
  return body;
}

export type EnrichOutcome = { result: "trouve" | "rien" | "injoignable" | "bloque" | "robots"; filled: string[]; detail: string; pages: string[] };

/** Enrichit une fiche (sans passer par la file). */
export async function enrichBusiness(id: number): Promise<EnrichOutcome> {
  const b = getBusiness(id);
  if (!b) return { result: "rien", filled: [], detail: "Fiche introuvable.", pages: [] };
  const site = /^https?:\/\//i.test(b.site_web) ? b.site_web : b.site_web ? "https://" + b.site_web : "";
  const pages: string[] = [];
  const done = (o: EnrichOutcome) => {
    db.prepare("UPDATE businesses SET enrich_status = ?, enrich_at = ? WHERE id = ?").run(o.result, now(), id);
    return o;
  };
  if (!site) return done({ result: "rien", filled: [], detail: "Pas de site web.", pages });
  let home: URL;
  try { home = new URL(site); } catch { return done({ result: "bloque", filled: [], detail: "Adresse du site invalide.", pages }); }
  const found: Found = { emails: [], facebook: "", instagram: "", tiktok: "", whatsapp: "", links: [] };
  const where: Record<string, string> = {};
  const absorb = (f: Found, url: string) => {
    const short = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    for (const e of f.emails) if (!found.emails.includes(e)) { found.emails.push(e); where["email:" + e] ??= short; }
    for (const k of ["facebook", "instagram", "tiktok", "whatsapp"] as const) if (!found[k] && f[k]) { found[k] = f[k]; where[k] = short; }
  };
  try {
    const robots = await robotsFor(home.origin);
    if (!robotsAllows(robots, home.pathname || "/")) return done({ result: "robots", filled: [], detail: "robots.txt interdit la page d'accueil.", pages });
    const r = await politeGet(home.toString());
    pages.push(r.url);
    if (r.status >= 400) return done({ result: "injoignable", filled: [], detail: `Le site répond ${r.status}.`, pages });
    const first = extract(r.text, r.url);
    absorb(first, r.url);
    const finalHome = new URL(r.url);
    for (const p of contactPages(finalHome.toString(), first.links)) {
      if (found.emails.length && found.facebook && found.instagram) break;
      const path = new URL(p).pathname;
      if (!robotsAllows(robots, path)) continue;
      try {
        const c = await politeGet(p);
        if (c.status < 400) { pages.push(c.url); absorb(extract(c.text, c.url), c.url); }
      } catch (e) { if (e instanceof FetchBlocked && e.kind === "ssrf") throw e; }
    }
  } catch (e) {
    if (e instanceof FetchBlocked) return done({ result: e.kind === "ssrf" || e.kind === "url" || e.kind === "redirect" ? "bloque" : "injoignable", filled: [], detail: e.message, pages });
    return done({ result: "injoignable", filled: [], detail: (e as Error).message.slice(0, 200), pages });
  }
  // Remplissage des champs vides uniquement (relecture : la fiche a pu changer pendant la récupération)
  const cur = getBusiness(id)!;
  const sets: Record<string, unknown> = {};
  const filled: string[] = [];
  const day = today();
  const origin = (what: string, at: string) => `${what} trouvé sur ${at} le ${day}`;
  const domain = home.hostname.replace(/^www\./, "");
  const email = found.emails.find((e) => e.endsWith("@" + domain) || e.endsWith("." + domain)) ?? found.emails[0];
  if (!cur.email && email) { sets.email = email; filled.push("email"); recordOrigin(id, "email", email, origin("email", where["email:" + email])); }
  for (const k of ["facebook", "instagram", "tiktok"] as const) {
    if (!cur[k] && found[k]) { sets[k] = found[k]; filled.push(k); recordOrigin(id, k, found[k], origin(k === "tiktok" ? "TikTok" : k === "facebook" ? "Facebook" : "Instagram", where[k])); }
  }
  if (found.whatsapp) {
    const n = waNumber(found.whatsapp);
    if (n && !cur.no_whatsapp && !cur.wa_confirme) { sets.wa_confirme = 1; filled.push("whatsapp_oui"); recordOrigin(id, "wa_confirme", n, origin("lien WhatsApp", where.whatsapp)); }
    if (n && !cur.whatsapp && telNorm(n) !== cur.tel_norm) { sets.whatsapp = n; filled.push("whatsapp"); recordOrigin(id, "whatsapp", n, origin("numéro WhatsApp", where.whatsapp)); }
    if (n && !cur.tel_norm) { sets.telephone = n; sets.tel_norm = telNorm(n); filled.push("telephone"); }
  }
  const keys = Object.keys(sets);
  if (keys.length) db.prepare(`UPDATE businesses SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => sets[k]), id);
  return done({ result: filled.length ? "trouve" : "rien", filled, detail: filled.length ? `Ajouté : ${filled.join(", ")}.` : "Rien de nouveau sur le site.", pages });
}

// ---------- Worker (même modèle que le géocodage) ----------
const MAX_ATTEMPTS = 3;
const IDLE_MS = 60_000;
export const enricherEnabled = () => process.env.ENRICHER !== "off";

function schedule(ms: number) {
  if (E.timer) clearTimeout(E.timer);
  E.timer = setTimeout(() => { void tick(); }, ms);
  E.timer.unref?.();
}
export async function tick(): Promise<number> {
  if (E.running) return 0;
  E.running = true;
  let n = 0;
  try {
    const next = db.prepare("SELECT business_id FROM enrich_queue WHERE done_at IS NULL AND next_try_at <= ? ORDER BY next_try_at, added_at, business_id LIMIT 1");
    for (;;) {
      const row = next.get(Date.now()) as { business_id: number } | undefined;
      if (!row) break;
      const id = row.business_id;
      try {
        const o = await enrichBusiness(id);
        db.prepare("UPDATE enrich_queue SET done_at = ?, result = ? WHERE business_id = ?").run(now(), o.result, id);
      } catch (e) {
        const a = ((db.prepare("SELECT attempts FROM enrich_queue WHERE business_id = ?").get(id) as { attempts: number } | undefined)?.attempts ?? 0) + 1;
        if (a >= MAX_ATTEMPTS) db.prepare("UPDATE enrich_queue SET done_at = ?, result = 'erreur', attempts = ? WHERE business_id = ?").run(now(), a, id);
        else db.prepare("UPDATE enrich_queue SET attempts = ?, next_try_at = ? WHERE business_id = ?").run(a, Date.now() + 60_000 * 2 ** a, id);
        console.warn(`[bedolt-crm] enrichissement : ${(e as Error).message} (fiche ${id}, essai ${a}/${MAX_ATTEMPTS})`);
      }
      n++;
    }
  } finally { E.running = false; }
  const soon = (db.prepare("SELECT MIN(next_try_at) t FROM enrich_queue WHERE done_at IS NULL").get() as { t: number | null }).t;
  if (E.started) schedule(soon ? Math.min(IDLE_MS, Math.max(500, soon - Date.now())) : IDLE_MS);
  return n;
}
export const enricherRunning = () => E.running;

/** Démarre le worker (instrumentation.ts). ENRICHER=off le désactive. */
export function startEnricher() {
  if (!enricherEnabled() || E.started) return;
  E.started = true;
  enrichHooks.kick = () => { if (!E.running) schedule(50); };
  schedule(5000);
  console.log(`[bedolt-crm] enrichissement : worker démarré (1 requête / seconde par domaine, ${UA})`);
}
