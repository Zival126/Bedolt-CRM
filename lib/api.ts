// Aides pour les routes API : gestion d'erreurs homogène (jamais de 500 pour une entrée invalide) + validation zod.
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError } from "./session";

z.config(z.locales.fr());

/** « champ : message » pour chaque problème, lisible par un humain. */
export function formatZod(err: z.ZodError): string {
  return err.issues.slice(0, 5).map((i) => (i.path.length ? `${i.path.join(".")} : ` : "") + i.message).join(" · ");
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, "Entrée invalide — " + formatZod(r.error));
  return r.data;
}

/** Lit le corps JSON et le valide ; JSON illisible ou invalide → 400. */
export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let data: unknown;
  try { data = JSON.parse(await req.text()); } catch { throw new HttpError(400, "JSON invalide."); }
  return parse(schema, data);
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;
/** Enveloppe une route : HttpError → statut + {error}, toute autre erreur → 500 générique (détail dans les logs). */
export function route<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      // redirect()/notFound() de Next : on laisse passer
      if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
      console.error("[bedolt-crm] erreur route", new URL(req.url).pathname, e);
      return NextResponse.json({ error: "Erreur interne." }, { status: 500 });
    }
  };
}

// Petits schémas réutilisés
export const zId = z.coerce.number().int().positive().max(2 ** 31);
export const zText = (max = 2000) => z.string().max(max).default("");
