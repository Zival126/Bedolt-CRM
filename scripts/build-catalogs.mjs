#!/usr/bin/env node
// Construit les catalogues officiels INEGI stockés dans le dépôt (config/) :
//   - config/scian-2023.json        : SCIAN México 2023 (secteur → classe) + index des biens et services par classe ;
//   - config/municipios-qroo.json   : municipios de Quintana Roo (entité 23) ;
//   - config/localidades-qroo.json  : localidades de Quintana Roo (Marco Geoestadístico / Catálogo Único de Claves).
// Sources (aucune donnée saisie de mémoire) :
//   SCIAN : https://www.inegi.org.mx/contenidos/app/scian/scian_2023_categorias_y_productos.xlsx (page https://www.inegi.org.mx/scian/)
//   Géo   : https://gaia.inegi.org.mx/wscatgeo/v2/mgem/23 et /v2/localidades/23MMM (service web du Catálogo Único de Claves Geoestadísticas)
// Usage : node scripts/build-catalogs.mjs [--scian fichier.xlsx]     (relancer après une mise à jour d'INEGI)
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const SCIAN_URL = "https://www.inegi.org.mx/contenidos/app/scian/scian_2023_categorias_y_productos.xlsx?v=20230719";
const GEO = "https://gaia.inegi.org.mx/wscatgeo/v2";
const ENT = "23";
const MIN_POB = 50; // localidades de moins de 50 habitants ignorées (hameaux, ranchos) ; « Autre code… » reste possible
const out = (f) => path.resolve("config", f);
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, type = "json") {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "BedoltCRM/1.0 (catalogues)" }, signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return type === "json" ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i >= 3) throw new Error(`${url} : ${e.message}`);
      await sleep(1500 * i);
    }
  }
}

const text = (v) => {
  if (v == null) return "";
  if (typeof v === "object" && Array.isArray(v.richText)) return v.richText.map((x) => x.text).join("");
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  return String(v);
};
// Titres : exposant « T » (catégorie trinacionale) / « US » / « CAN » / « MÉX » retiré
const cleanTitle = (s) => s.replace(/\s+/g, " ").replace(/\s*(T|US|CAN|MÉX|MEX)\s*$/u, "").trim();

async function scian(file) {
  const buf = file ? fs.readFileSync(file) : await get(SCIAN_URL, "buf");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const levels = { SECTOR: 2, SUBSECTOR: 3, RAMA: 4, SUBRAMA: 5, CLASE: 6 };
  const entries = new Map();
  const products = new Map();
  for (const [sheet, level] of Object.entries(levels)) {
    const ws = wb.getWorksheet(sheet);
    if (!ws) throw new Error(`Feuille ${sheet} absente du fichier SCIAN`);
    ws.eachRow((row, i) => {
      if (i < 3) return;
      const code = text(row.getCell(1).value).trim();
      if (!/^\d{2}(-\d{2})?$|^\d{3,6}$/.test(code)) return;
      const title = cleanTitle(text(row.getCell(2).value));
      if (!entries.has(code)) entries.set(code, { c: code, t: title, l: level });
      if (level === 6) {
        const p = text(row.getCell(6).value).replace(/\s+/g, " ").trim();
        if (p) { const s = products.get(code) ?? new Set(); s.add(p); products.set(code, s); }
      }
    });
  }
  const list = [...entries.values()].sort((a, b) => a.c.localeCompare(b.c));
  const prod = Object.fromEntries([...products].map(([c, s]) => [c, [...s].join(" | ").slice(0, 6000)]));
  const data = {
    _source: "INEGI. Sistema de Clasificación Industrial de América del Norte, México SCIAN 2023 — fichier « scian_2023_categorias_y_productos.xlsx » (https://www.inegi.org.mx/scian/). Généré par scripts/build-catalogs.mjs, ne pas modifier à la main.",
    _url: SCIAN_URL, _date: today,
    counts: Object.fromEntries(Object.entries(levels).map(([k, l]) => [k, list.filter((e) => e.l === l).length])),
    entries: list, products: prod,
  };
  fs.writeFileSync(out("scian-2023.json"), JSON.stringify(data));
  console.log(`SCIAN 2023 : ${list.length} catégories, ${Object.keys(prod).length} classes avec index (${(fs.statSync(out("scian-2023.json")).size / 1e6).toFixed(2)} Mo)`);
}

async function geo() {
  const m = await get(`${GEO}/mgem/${ENT}`);
  const municipios = m.datos.map((d) => ({ code: d.cve_mun, nom: d.nomgeo })).sort((a, b) => a.code.localeCompare(b.code));
  const locs = [];
  for (const mu of municipios) {
    await sleep(400);
    const l = await get(`${GEO}/localidades/${ENT}${mu.code}`);
    for (const d of l.datos ?? []) {
      const pob = Number(d.pob_total) || 0;
      if (pob < MIN_POB && d.cve_loc !== "0001") continue;
      locs.push({ m: d.cve_mun, c: d.cve_loc, n: d.nomgeo, p: pob, lat: Number(d.latitud) || null, lng: Number(d.longitud) || null });
    }
  }
  locs.sort((a, b) => a.m.localeCompare(b.m) || b.p - a.p);
  fs.writeFileSync(out("municipios-qroo.json"), JSON.stringify({
    _note: "Valeur par défaut (dépôt), générée depuis le Catálogo Único de Claves Geoestadísticas d'INEGI (Marco Geoestadístico) par scripts/build-catalogs.mjs. Pour personnaliser : copie ce fichier dans data/municipios-qroo.json (non versionné).",
    _source: `${GEO}/mgem/${ENT}`, _date: today, entidad: ENT, municipios,
  }, null, 2) + "\n");
  fs.writeFileSync(out("localidades-qroo.json"), JSON.stringify({
    _source: `INEGI, Catálogo Único de Claves Geoestadísticas (${GEO}/localidades/${ENT}MMM). Localidades de ${MIN_POB} habitants et plus (pob_total, Censo 2020) + chefs-lieux.`,
    _date: today, entidad: ENT, localidades: locs,
  }) + "\n");
  console.log(`Quintana Roo : ${municipios.length} municipios, ${locs.length} localidades`);
}

const i = process.argv.indexOf("--scian");
await scian(i > 0 ? process.argv[i + 1] : undefined);
await geo();
