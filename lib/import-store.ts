// Fichiers d'import en attente (entre l'envoi et la validation) : gardés en mémoire côté serveur, jamais renvoyés en
// entier au navigateur. globalThis : partagé entre toutes les routes du process. Expiration 1 h, 10 fichiers maximum.
import { randomBytes } from "node:crypto";
import type { FileData, ImportFormat } from "./import";

export type Staged = FileData & { token: string; fileName: string; format: ImportFormat; createdAt: number; done?: boolean };
const TTL = 60 * 60 * 1000;
const MAX = 10;

const g = globalThis as unknown as { __importStore?: Map<string, Staged> };
const store: Map<string, Staged> = g.__importStore ?? (g.__importStore = new Map());

function purge() {
  const limit = Date.now() - TTL;
  for (const [k, v] of store) if (v.createdAt < limit) store.delete(k);
  while (store.size >= MAX) store.delete(store.keys().next().value!);
}

export function stage(d: Omit<Staged, "token" | "createdAt">): Staged {
  purge();
  const s: Staged = { ...d, token: randomBytes(16).toString("hex"), createdAt: Date.now() };
  store.set(s.token, s);
  return s;
}
export const getStaged = (token: string) => {
  const s = store.get(token);
  return s && s.createdAt >= Date.now() - TTL ? s : undefined;
};
export const dropStaged = (token: string) => store.delete(token);
