// Chargeur de modules pour les tests (node:test, sans dépendance) : alias « @/… », imports TypeScript sans extension,
// JSON importé comme module. Utilisé avec --experimental-transform-types (Node ≥ 22.7).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tryFile = (p) => [p, p + ".ts", p + ".tsx", path.join(p, "index.ts")].find((f) => existsSync(f) && !f.endsWith("/"));

export async function resolve(spec, ctx, next) {
  let base = null;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL?.startsWith("file:")) base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
  if (base) {
    const f = tryFile(base);
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  // Sous-chemins de Next sans extension (« next/headers », « next/navigation ») : fichiers .js du paquet
  if (/^next\/[\w/-]+$/.test(spec)) return next(spec + ".js", ctx);
  return next(spec, ctx);
}

export async function load(url, ctx, next) {
  if (url.endsWith(".json") && url.startsWith("file:")) {
    return { format: "module", source: `export default ${readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
  }
  return next(url, ctx);
}
