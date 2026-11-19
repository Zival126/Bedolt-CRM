// Protection SSRF des URL IA (Ollama, n8n) : seules les cibles attendues sont joignables depuis le serveur.
//
// Autorisé : http/https vers une IP publique, la plage Tailscale 100.64.0.0/10 (et son IPv6 fd7a:115c:a1e0::/48),
// les noms *.ts.net, et les hôtes listés dans AI_ALLOWED_HOSTS (.env, séparés par des virgules).
// Refusé : loopback, 0.0.0.0/8, link-local (169.254.0.0/16, fe80::/10), réseaux privés (10/8, 172.16/12,
// 192.168/16, fc00::/7), multicast et plages réservées. Le DNS est résolu AVANT la vérification : toutes les
// adresses renvoyées doivent être autorisées.
// Limite connue : un DNS qui change entre la vérification et la connexion (rebinding) n'est pas couvert ;
// le risque est faible (réglage accessible uniquement après connexion) et les redirections HTTP sont refusées.
import dns from "node:dns/promises";
import net from "node:net";

export class UrlRefused extends Error {}

const v4 = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const inV4 = (ip: string, base: string, bits: number) => {
  const size = 2 ** (32 - bits);
  return Math.floor(v4(ip) / size) === Math.floor(v4(base) / size);
};
const BLOCKED_V4: [string, number, string][] = [
  ["0.0.0.0", 8, "adresse 0.0.0.0/8"], ["127.0.0.0", 8, "loopback"], ["10.0.0.0", 8, "réseau privé"],
  ["172.16.0.0", 12, "réseau privé"], ["192.168.0.0", 16, "réseau privé"], ["169.254.0.0", 16, "link-local"],
  ["192.0.0.0", 24, "plage réservée"], ["198.18.0.0", 15, "plage réservée"], ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "plage réservée"],
];

function expandV6(ip: string): number[] {
  let x = ip.toLowerCase();
  const dotted = x.match(/(\d+\.\d+\.\d+\.\d+)$/); // forme ::ffff:1.2.3.4
  if (dotted) {
    const n = v4(dotted[1]);
    x = x.slice(0, -dotted[1].length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const [head, tail = ""] = x.split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const groups = x.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return groups.map((g) => parseInt(g || "0", 16));
}
const embeddedV4 = (g: number[]) => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;

/** Raison du refus, ou null si l'IP est autorisée. */
export function ipRefusal(ip: string): string | null {
  if (net.isIPv4(ip)) {
    if (inV4(ip, "100.64.0.0", 10)) return null; // Tailscale (CGNAT)
    for (const [base, bits, why] of BLOCKED_V4) if (inV4(ip, base, bits)) return why;
    return null;
  }
  if (net.isIPv6(ip)) {
    const g = expandV6(ip);
    if (g.length !== 8 || g.some((n) => Number.isNaN(n))) return "adresse IP invalide";
    const zero = (a: number, b: number) => g.slice(a, b).every((n) => n === 0);
    if (zero(0, 8)) return "adresse ::";
    if (zero(0, 7) && g[7] === 1) return "loopback";
    // IPv4 embarquée : ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), 64:ff9b::a.b.c.d (NAT64) → règles IPv4
    if (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return ipRefusal(embeddedV4(g));
    if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return ipRefusal(embeddedV4(g));
    if (g[0] === 0xfd7a && g[1] === 0x115c && g[2] === 0xa1e0) return null; // Tailscale IPv6
    if ((g[0] & 0xffc0) === 0xfe80) return "link-local";
    if ((g[0] & 0xfe00) === 0xfc00) return "réseau privé";
    if ((g[0] & 0xff00) === 0xff00) return "multicast";
    return null;
  }
  return "adresse IP invalide";
}

const allowedHosts = () =>
  (process.env.AI_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

/** Vérifie l'URL ; lève UrlRefused avec un message clair si elle n'est pas autorisée. */
export async function assertSafeAiUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new UrlRefused("URL invalide."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UrlRefused("Seuls http:// et https:// sont acceptés.");
  if (u.username || u.password) throw new UrlRefused("Identifiants dans l'URL non acceptés.");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (allowedHosts().includes(host)) return u;
  if (host.endsWith(".ts.net")) return u;
  let addrs: string[];
  if (net.isIP(host)) addrs = [host];
  else {
    try { addrs = (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address); }
    catch { throw new UrlRefused(`Nom d'hôte introuvable : ${host}`); }
  }
  for (const a of addrs) {
    const why = ipRefusal(a);
    if (why) throw new UrlRefused(`URL refusée : ${host} → ${a} (${why}). Utilise l'IP Tailscale (100.x.y.z), un nom *.ts.net, ou ajoute l'hôte à AI_ALLOWED_HOSTS dans .env.`);
  }
  return u;
}

/** fetch() vers une URL IA : vérification SSRF, pas de redirection, délai maximum. */
export async function aiFetch(url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  await assertSafeAiUrl(url);
  const { timeoutMs, signal, ...rest } = init;
  const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
  return fetch(url, { ...rest, redirect: "error", cache: "no-store", signal: AbortSignal.any(signals) });
}
