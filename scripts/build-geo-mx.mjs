#!/usr/bin/env node
// Catalogue géographique national (officiel) → config/geo-mx/ :
//   entidades.json   : les 32 entidades (code, nom, abréviation, population) ;
//   municipios.json  : tous les municipios (entidad, code, nom, code de la cabecera, population) ;
//   localidades.json : localidades urbaines, cabeceras municipales et localidades de 2 500 hab. et plus (code, nom,
//                      point lat/lng, population). Les autres localidades (rurales) sont chargées à la demande par
//                      le serveur depuis le même service, avec cache en base (lib/geo-mx.ts).
// Source : INEGI, Catálogo Único de Claves Geoestadísticas (Marco Geoestadístico), service web
//   https://gaia.inegi.org.mx/wscatgeo/v2/ (mgee/, mgem/{ent}, localidades/{ent}{mun}). Rien n'est saisi de mémoire.
// Usage : NODE_USE_ENV_PROXY=1 node scripts/build-geo-mx.mjs     (≈ 2 500 requêtes, 3 en parallèle, 10-30 min)
import fs from "node:fs";
import path from "node:path";

const GEO = "https://gaia.inegi.org.mx/wscatgeo/v2";
const OUT = path.resolve("config/geo-mx");
const MIN_POB = 2500;
const PARALLEL = 3;
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(p) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(`${GEO}/${p}`, { headers: { "User-Agent": "BedoltCRM/1.0 (catalogues)" }, signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()).datos ?? [];
    } catch (e) {
      if (i >= 5) throw new Error(`${p} : ${e.message}`);
      await sleep(2000 * i);
    }
  }
}

const ents = (await get("mgee/")).map((d) => ({ c: d.cve_ent, n: d.nomgeo, a: d.nom_abrev, p: Number(d.pob_total) || 0 }));
if (ents.length !== 32) throw new Error(`32 entidades attendues, ${ents.length} reçues`);
const munis = [];
for (const e of ents) {
  for (const d of await get(`mgem/${e.c}`)) munis.push({ e: d.cve_ent, m: d.cve_mun, n: d.nomgeo, cab: d.cve_cab, p: Number(d.pob_total) || 0 });
  await sleep(200);
}
console.log(`${ents.length} entidades, ${munis.length} municipios`);

const locs = [];
let done = 0, totalLocs = 0;
const queue = [...munis];
async function worker() {
  for (;;) {
    const m = queue.shift();
    if (!m) return;
    const rows = await get(`localidades/${m.e}${m.m}`);
    totalLocs += rows.length;
    for (const d of rows) {
      const p = Number(d.pob_total) || 0;
      if (d.ambito !== "URBANO" && d.cve_loc !== m.cab && p < MIN_POB) continue;
      const lat = Number(d.latitud), lng = Number(d.longitud);
      locs.push({ e: d.cve_ent, m: d.cve_mun, c: d.cve_loc, n: d.nomgeo, p, u: d.ambito === "URBANO" ? 1 : 0,
        lat: Number.isFinite(lat) && lat ? Math.round(lat * 1e5) / 1e5 : null, lng: Number.isFinite(lng) && lng ? Math.round(lng * 1e5) / 1e5 : null });
    }
    m.nl = rows.length;
    if (++done % 100 === 0) console.log(`  ${done} / ${munis.length} municipios · ${locs.length} localidades gardées`);
    await sleep(150);
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker));
locs.sort((a, b) => a.e.localeCompare(b.e) || a.m.localeCompare(b.m) || b.p - a.p);

fs.mkdirSync(OUT, { recursive: true });
const meta = { _source: "INEGI, Catálogo Único de Claves Geoestadísticas (Marco Geoestadístico), https://gaia.inegi.org.mx/wscatgeo/v2/ — population : Censo de Población y Vivienda 2020. Généré par scripts/build-geo-mx.mjs, ne pas modifier à la main.", _date: today };
fs.writeFileSync(path.join(OUT, "entidades.json"), JSON.stringify({ ...meta, entidades: ents }) + "\n");
fs.writeFileSync(path.join(OUT, "municipios.json"), JSON.stringify({ ...meta, municipios: munis }) + "\n");
fs.writeFileSync(path.join(OUT, "localidades.json"), JSON.stringify({ ...meta, _rule: `localidades urbaines, cabeceras municipales et localidades de ${MIN_POB} hab. et plus ; les autres sont chargées à la demande`, total_localidades_pays: totalLocs, localidades: locs }) + "\n");
const size = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + " Ko";
console.log(`Écrit : ${ents.length} entidades (${size("entidades.json")}), ${munis.length} municipios (${size("municipios.json")}), ${locs.length} localidades sur ${totalLocs} (${size("localidades.json")})`);
