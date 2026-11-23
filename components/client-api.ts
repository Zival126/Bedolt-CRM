// Appels JSON côté navigateur : toute erreur serveur devient une Error avec le message lisible (jamais silencieuse).
export async function postJson<T = Record<string, unknown>>(url: string, body: object): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch { throw new Error("Connexion impossible : vérifie le réseau."); }
  const j = await r.json().catch(() => ({ error: r.status === 401 ? "Session expirée : reconnecte-toi." : "Réponse illisible du serveur." }));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Erreur ${r.status}`);
  return j as T;
}

export async function getJson<T = Record<string, unknown>>(url: string): Promise<T> {
  let r: Response;
  try { r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" }); } catch { throw new Error("Connexion impossible : vérifie le réseau."); }
  const j = await r.json().catch(() => ({ error: r.status === 401 ? "Session expirée : reconnecte-toi." : "Réponse illisible du serveur." }));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Erreur ${r.status}`);
  return j as T;
}
