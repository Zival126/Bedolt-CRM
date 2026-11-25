// Récupération de pages web publiques pour l'enrichissement, en mode « Internet public uniquement ».
// - http/https, ports 80 / 443 seulement, pas d'identifiants dans l'URL ;
// - le DNS est résolu AVANT la connexion et TOUTES les adresses doivent être publiques : refus de loopback, réseaux
//   privés, link-local (dont 169.254.169.254, métadonnées cloud), CGNAT / Tailscale (100.64.0.0/10, fd7a:115c:a1e0::/48),
//   plages réservées ou de documentation, multicast, IPv4 embarquée dans IPv6 ;
// - la connexion se fait sur l'IP vérifiée (pas de seconde résolution : protège du « DNS rebinding ») ;
// - redirections suivies à la main (3 max), chacune revérifiée ;
// - réponse limitée à 1 Mo, délai 8 s, aucune exécution de JavaScript (texte brut), pas de compression.
import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { ipRefusal } from "./ai-guard";

export const UA = "BedoltCRM/1.0 (+https://crm.bedolt.com; contacto@bedolt.com)";
export const MAX_BYTES = 1024 * 1024;
export const TIMEOUT_MS = 8000;

export class FetchBlocked extends Error { constructor(msg: string, public kind: "ssrf" | "url" | "redirect" | "type" = "ssrf") { super(msg); } }
export class FetchFailed extends Error {}

const v4n = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const inV4 = (ip: string, base: string, bits: number) => Math.floor(v4n(ip) / 2 ** (32 - bits)) === Math.floor(v4n(base) / 2 ** (32 - bits));

/** Raison du refus (mode public strict), ou null si l'IP est publique. */
export function publicIpRefusal(ip: string): string | null {
  const base = ipRefusal(ip);
  if (base) return base;
  if (net.isIPv4(ip)) {
    if (inV4(ip, "100.64.0.0", 10)) return "CGNAT / Tailscale";
    for (const [b, bits] of [["192.0.2.0", 24], ["198.51.100.0", 24], ["203.0.113.0", 24], ["192.88.99.0", 24]] as const)
      if (inV4(ip, b, bits)) return "plage réservée";
    return null;
  }
  const x = ip.toLowerCase();
  if (/^fd7a:115c:a1e0:/.test(x)) return "Tailscale";
  if (/^2001:0?db8:/.test(x)) return "plage de documentation";
  if (/^(::ffff:|::)?(\d+\.){3}\d+$/.test(x)) { const v = x.replace(/^.*:/, ""); return publicIpRefusal(v); }
  return null;
}

export type Resolver = (host: string) => Promise<string[]>;
const systemResolve: Resolver = async (host) => (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Vérifie l'URL et renvoie l'IP publique à utiliser. */
export async function vetUrl(raw: string, resolve: Resolver = systemResolve): Promise<{ url: URL; ip: string }> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new FetchBlocked("URL invalide.", "url"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new FetchBlocked(`Protocole refusé (${u.protocol}).`, "url");
  if (u.username || u.password) throw new FetchBlocked("Identifiants dans l'URL refusés.", "url");
  if (u.port && !["80", "443"].includes(u.port)) throw new FetchBlocked(`Port refusé (${u.port}).`, "url");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || /\.(localhost|local|internal|lan|home|ts\.net|onion)$/.test(host) || (!net.isIP(host) && !host.includes(".")))
    throw new FetchBlocked(`Hôte refusé (${host}).`);
  let addrs: string[];
  if (net.isIP(host)) addrs = [host];
  else {
    try { addrs = await resolve(host); } catch { throw new FetchFailed(`Nom de domaine introuvable : ${host}`); }
  }
  if (!addrs.length) throw new FetchFailed(`Nom de domaine introuvable : ${host}`);
  for (const a of addrs) { const why = publicIpRefusal(a); if (why) throw new FetchBlocked(`Adresse interne refusée : ${host} → ${a} (${why}).`); }
  return { url: u, ip: addrs[0] };
}

export type RawResponse = { status: number; headers: Record<string, string>; body: Buffer; truncated: boolean };
export type Transport = (ip: string, url: URL, opts: { timeoutMs: number; maxBytes: number }) => Promise<RawResponse>;

/** Requête HTTP(S) sur l'IP donnée (SNI et Host = nom d'origine), corps limité, délai global. */
export const httpTransport: Transport = (ip, url, { timeoutMs, maxBytes }) => new Promise((resolve, reject) => {
  const mod = url.protocol === "https:" ? https : http;
  const req = mod.request({
    host: ip, servername: net.isIP(url.hostname) ? undefined : url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname + url.search, method: "GET", agent: false,
    lookup: (_h, _o, cb) => cb(null, ip, net.isIPv6(ip) ? 6 : 4),
    headers: { Host: url.host, "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain;q=0.8", "Accept-Encoding": "identity", "Accept-Language": "es-MX,es;q=0.9,en;q=0.5" },
  }, (res) => {
    const chunks: Buffer[] = [];
    let size = 0, truncated = false;
    res.on("data", (c: Buffer) => {
      if (truncated) return;
      size += c.length;
      if (size > maxBytes) { chunks.push(c.subarray(0, c.length - (size - maxBytes))); truncated = true; res.destroy(); finish(); return; }
      chunks.push(c);
    });
    const finish = () => { clearTimeout(timer); resolve({ status: res.statusCode ?? 0, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v ?? "")])), body: Buffer.concat(chunks), truncated }); };
    res.on("end", finish);
    res.on("error", (e) => { if (!truncated) { clearTimeout(timer); reject(e); } });
  });
  const timer = setTimeout(() => { req.destroy(new FetchFailed(`Délai dépassé (${timeoutMs / 1000} s).`)); }, timeoutMs);
  req.on("error", (e) => { clearTimeout(timer); reject(e instanceof FetchFailed ? e : new FetchFailed(`Site injoignable (${(e as NodeJS.ErrnoException).code ?? e.message}).`)); });
  req.end();
});

export type SafeResponse = { url: string; status: number; contentType: string; text: string; truncated: boolean; headers?: Record<string, string>; ms?: number };

/**
 * GET d'une page publique. Les redirections sont suivies (3 max) et chaque destination est revérifiée.
 * Seules les réponses texte (HTML / texte brut) sont lues.
 */
export async function safeGet(raw: string, opts: { resolve?: Resolver; transport?: Transport; timeoutMs?: number; maxBytes?: number; maxRedirects?: number; textOnly?: boolean } = {}): Promise<SafeResponse> {
  const transport = opts.transport ?? httpTransport;
  let current = raw;
  const t0 = Date.now();
  for (let hop = 0; ; hop++) {
    const { url, ip } = await vetUrl(current, opts.resolve);
    const r = await transport(ip, url, { timeoutMs: opts.timeoutMs ?? TIMEOUT_MS, maxBytes: opts.maxBytes ?? MAX_BYTES });
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      if (hop >= (opts.maxRedirects ?? 3)) throw new FetchBlocked("Trop de redirections.", "redirect");
      current = new URL(r.headers.location, url).toString();
      continue;
    }
    const contentType = (r.headers["content-type"] ?? "").toLowerCase();
    if (opts.textOnly !== false && contentType && !/text\/html|application\/xhtml|text\/plain/.test(contentType))
      throw new FetchBlocked(`Contenu non textuel ignoré (${contentType.split(";")[0]}).`, "type");
    const charset = contentType.match(/charset=([\w-]+)/)?.[1]?.toLowerCase();
    let text: string;
    try { text = new TextDecoder(charset && charset !== "utf8" ? charset : "utf-8").decode(r.body); } catch { text = r.body.toString("utf8"); }
    return { url: url.toString(), status: r.status, contentType, text, truncated: r.truncated, headers: r.headers, ms: Date.now() - t0 };
  }
}
