import net from "node:net";
import { boundToLoopback } from "./bind";

/**
 * Le serveur n'écoute que sur 127.0.0.1 (`next start -H 127.0.0.1`) : toute connexion TCP vient donc du proxy
 * local (OpenLiteSpeed). On ne fait confiance à X-Forwarded-For QUE dans ce cas, vérifié sur les arguments de
 * lancement. Sinon (écoute publique, `next dev`…) l'en-tête pourrait être forgé : on l'ignore.
 */
const TRUST_PROXY = boundToLoopback();
const norm = (ip: string) => (ip.startsWith("::ffff:") && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip);

/**
 * IP du client : DERNIÈRE valeur de X-Forwarded-For, c'est-à-dire celle ajoutée par le proxy local
 * (les valeurs précédentes peuvent être forgées par le client).
 * Sans en-tête, Next.js y place lui-même l'adresse du socket (127.0.0.1 pour un appel local direct).
 */
export function clientIp(req: Request): string {
  if (!TRUST_PROXY) return "non-fiable";
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const last = norm(xff.split(",").map((s) => s.trim()).filter(Boolean).pop() ?? "");
  return net.isIP(last) ? last : "inconnue";
}
