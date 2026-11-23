// Vues enregistrées de Commerces (filtres de l'URL) et colonnes du tableau (Réglages implicites, un seul utilisateur).
import { db, now } from "./db";
import { getSetting, setSetting } from "./settings";
import { ColumnsSchema, DEFAULT_COLUMNS, type ColumnKey } from "./columns";

export type SavedView = { id: number; name: string; query: string };
export const savedViews = () => db.prepare("SELECT id, name, query FROM saved_views ORDER BY name COLLATE NOCASE, id").all() as SavedView[];

/** Requête nettoyée : seulement les paramètres de liste (jamais la page). */
export function cleanQuery(q: string): string {
  const p = new URLSearchParams(q.replace(/^\?/, ""));
  p.delete("page");
  return p.toString().slice(0, 2000);
}
export function saveView(name: string, query: string): number {
  const q = cleanQuery(query);
  const ex = db.prepare("SELECT id FROM saved_views WHERE lower(name) = lower(?)").get(name) as { id: number } | undefined;
  if (ex) { db.prepare("UPDATE saved_views SET query = ? WHERE id = ?").run(q, ex.id); return ex.id; }
  return Number(db.prepare("INSERT INTO saved_views(name, query, created_at) VALUES(?,?,?)").run(name, q, now()).lastInsertRowid);
}
export const deleteView = (id: number) => db.prepare("DELETE FROM saved_views WHERE id = ?").run(id).changes;

export function commerceColumns(): ColumnKey[] {
  try {
    const r = ColumnsSchema.safeParse(JSON.parse(getSetting("commerce_columns") || "null"));
    if (r.success) return r.data;
  } catch { /* défaut */ }
  return DEFAULT_COLUMNS;
}
export const saveColumns = (c: ColumnKey[]) => setSetting("commerce_columns", JSON.stringify(c));
