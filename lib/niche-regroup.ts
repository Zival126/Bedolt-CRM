// Regroupement des niches (page Niches > Regrouper) : des centaines de « niches » de 1 à 3 fiches, créées par erreur
// à l'import (description détaillée dans la colonne Niche), sont rattachées à une dizaine de niches principales.
// - Proposition déterministe (lib/niche-classify.ts) : libellé de la niche, puis activité des fiches (code SCIAN DENUE,
//   catégorie Overture / OSM).
// - Application : une transaction ; l'ancien libellé va dans la spécialité des fiches (si vide) et devient un mot-clé de
//   la niche cible ; les niches vidées sont supprimées ; état complet gardé pour « Annuler le dernier regroupement ».
import { db, now } from "./db";
import { MAIN_NICHES, compile, classifyText, foldText, SURE, type MainNiche } from "./niche-classify";
import { allNiches, bumpNicheOps, nicheOpsSeq, nicheStats, remapIds, NicheError } from "./niches";
import { nextColor, isIcon } from "./niche-style";
import { scianTitle } from "./scian";

export type Main = { key: string; label: string; icon: string };
export type Target = string;           // clé d'une niche principale, "none" (sans niche) ou "keep" (garder telle quelle)
export type PlanRow = {
  id: number; label: string; fiches: number; archived: boolean; color: string; icon: string;
  target: Target; confidence: number; reason: string; main: boolean;
};

/** Niches principales par défaut (clé, libellé, icône) + description, pour l'écran de regroupement. */
export const defaultMains = () => MAIN_NICHES.map((m) => ({ key: m.key, label: m.label, icon: m.icon, desc: m.desc }));

/** Liste de niches principales effective : celles par défaut (mots-clés) + libellés modifiés / ajoutés à l'écran. */
function mainDefs(mains: Main[]): MainNiche[] {
  return mains.map((m) => {
    const d = MAIN_NICHES.find((x) => x.key === m.key);
    return d ? { ...d, label: m.label, icon: m.icon, aliases: [...(d.aliases ?? []), d.label] } : { key: m.key, label: m.label, icon: m.icon, desc: "", words: [] };
  });
}

/** Activité connue des fiches d'une niche → niche principale la plus fréquente. */
function ficheSignals(c: ReturnType<typeof compile>) {
  const by = new Map<number, Map<string, number>>();
  const total = new Map<number, number>();
  const cache = new Map<string, string | null>();
  const cls = (t: string) => { if (!cache.has(t)) cache.set(t, classifyText(t, c).key); return cache.get(t)!; };
  for (const r of db.prepare("SELECT niche_id, denue_id, activite FROM businesses WHERE niche_id IS NOT NULL").iterate() as Iterable<{ niche_id: number; denue_id: string; activite: string }>) {
    const sigs: string[] = [];
    if (/^\d{11}/.test(r.denue_id ?? "")) { const t = scianTitle(r.denue_id.slice(5, 11)); if (t) sigs.push(t); }
    const a = (r.activite ?? "").trim();
    if (a) sigs.push(a.replace(/[_=:]/g, " "));
    for (const s of sigs) {
      const k = cls(s);
      total.set(r.niche_id, (total.get(r.niche_id) ?? 0) + 1);
      if (!k) continue;
      const m = by.get(r.niche_id) ?? new Map<string, number>();
      m.set(k, (m.get(k) ?? 0) + 1); by.set(r.niche_id, m);
    }
  }
  return (id: number): { key: string; share: number; n: number } | null => {
    const m = by.get(id); if (!m) return null;
    const [key, n] = [...m].sort((a, b) => b[1] - a[1])[0];
    return { key, n, share: n / (total.get(id) ?? n) };
  };
}

/** Proposition pour chaque niche existante. */
export function buildPlan(mains: Main[] = defaultMains()): { mains: Main[]; rows: PlanRow[]; summary: { auto: number; unsure: number; none: number; fiches: number } } {
  const defs = mainDefs(mains);
  const c = compile(defs);
  const sig = ficheSignals(c);
  const stats = nicheStats();
  const rows: PlanRow[] = allNiches({ archived: true }).map((n) => {
    const fiches = stats.get(n.id)?.fiches ?? 0;
    const k = classifyText(n.label, c);
    const s = sig(n.id);
    let target: Target = k.key ?? "none", conf = k.confidence, reason = k.key ? `mot-clé ${k.reason}` : "aucun mot-clé reconnu";
    if (s && s.share >= 0.6) {
      if (!k.key) { target = s.key; conf = s.n >= 3 && s.share >= 0.8 ? 72 : 58; reason = `activité des fiches (${s.n} fiche(s))`; }
      else if (s.key === k.key) { conf = Math.min(99, conf + 10); reason += " · confirmé par l'activité des fiches"; }
      else if (s.n >= 3 && s.share >= 0.8 && k.confidence < 100) { conf = Math.max(20, conf - 25); reason += ` · l'activité des fiches indique « ${defs.find((d) => d.key === s.key)?.label} »`; }
    }
    return { id: n.id, label: n.label, fiches, archived: n.archived, color: n.color, icon: n.icon, target, confidence: target === "none" ? 0 : conf, reason, main: k.confidence === 100 };
  });
  rows.sort((a, b) => b.fiches - a.fiches || a.label.localeCompare(b.label, "fr"));
  const moving = rows.filter((r) => !r.main);
  return {
    mains, rows,
    summary: {
      auto: moving.filter((r) => r.target !== "none" && r.confidence >= SURE).length,
      unsure: moving.filter((r) => r.target !== "none" && r.confidence < SURE).length,
      none: moving.filter((r) => r.target === "none").length, fiches: rows.reduce((a, r) => a + r.fiches, 0),
    },
  };
}

export type ApplyResult = { id: number; merged: number; moved: number; noNiche: number; created: number; mains: number; backup: string };
type Snapshot = { niches: Record<string, unknown>[]; maps: Record<string, unknown>[]; objectives: string | null; dayFilters: { day: string; filter: string; relances: number }[] };

/** Applique le regroupement (une transaction). `assign` : id de niche → clé principale | "none" | "keep". */
export function applyRegroup(mains: Main[], assign: Record<number, Target>, backup = ""): ApplyResult {
  const keys = new Set(mains.map((m) => m.key));
  for (const m of mains) if (!m.label.trim() || !isIcon(m.icon)) throw new NicheError(`Niche principale invalide : « ${m.label} ».`);
  if (new Set(mains.map((m) => foldText(m.label))).size !== mains.length) throw new NicheError("Deux niches principales ont le même nom.");
  for (const t of Object.values(assign)) if (t !== "none" && t !== "keep" && !keys.has(t)) throw new NicheError("Niche cible inconnue.");
  const niches = allNiches({ archived: true });
  const stats = nicheStats();
  return db.transaction(() => {
    const snap: Snapshot = {
      niches: db.prepare("SELECT * FROM niches").all() as Record<string, unknown>[],
      maps: db.prepare("SELECT * FROM niche_maps").all() as Record<string, unknown>[],
      objectives: (db.prepare("SELECT value FROM settings WHERE key = 'objectives'").get() as { value: string } | undefined)?.value ?? null,
      dayFilters: db.prepare("SELECT day, filter, relances FROM day_filters").all() as Snapshot["dayFilters"],
    };
    const rid = Number(db.prepare("INSERT INTO niche_regroups(at, snapshot, backup) VALUES(?,?,?)").run(now(), JSON.stringify(snap), backup).lastInsertRowid);
    const log = db.prepare(`INSERT OR IGNORE INTO niche_regroup_items(regroup_id, business_id, old_niche_id, old_niche, old_specialite)
      SELECT ?, id, niche_id, COALESCE(niche, ''), COALESCE(specialite, '') FROM businesses WHERE niche_id = ?`);
    const move = db.prepare(`UPDATE businesses SET specialite = CASE WHEN COALESCE(specialite, '') = '' THEN ? ELSE specialite END, niche_id = ?, niche = ? WHERE niche_id = ?`);
    const addKw = db.prepare("INSERT OR IGNORE INTO niche_maps(niche_id, kind, value) VALUES(?, 'keyword', ?)");
    const remap = new Map<number, number | null>();
    let merged = 0, moved = 0, noNiche = 0, created = 0, nMains = 0;
    const usedColors = niches.filter((n) => !n.archived).map((n) => n.color);
    let pos = (db.prepare("SELECT COALESCE(MAX(position), 0) p FROM niches").get() as { p: number }).p;

    for (const [mi, m] of mains.entries()) {
      const sources = niches.filter((n) => assign[n.id] === m.key);
      nMains++;
      if (!sources.length) {
        // Niche principale encore vide : créée pour servir de cible (imports, prompt Gemini, sources)
        if (!db.prepare("SELECT 1 FROM niches WHERE label = ? COLLATE NOCASE").get(m.label)) {
          const color = nextColor(usedColors); usedColors.push(color);
          const id = Number(db.prepare("INSERT INTO niches(label, color, icon, position, created_at) VALUES(?,?,?,?,?)").run(m.label, color, m.icon, mi + 1, now()).lastInsertRowid);
          const def = MAIN_NICHES.find((d) => d.key === m.key);
          for (const a of def ? [def.label, ...(def.aliases ?? [])].map(foldText) : []) if (a && a !== foldText(m.label)) addKw.run(id, a);
          created++;
        }
        continue;
      }
      const fm = foldText(m.label);
      const def = MAIN_NICHES.find((d) => d.key === m.key);
      const aliasSet = new Set([fm, ...(def ? [def.label, ...(def.aliases ?? [])].map(foldText) : [])]);
      // Niche gardée : même nom que la principale, sinon la plus grosse (≥ 20 fiches), sinon nouvelle niche
      const size = (n: { id: number }) => stats.get(n.id)?.fiches ?? 0;
      let kept = sources.find((n) => foldText(n.label) === fm) ?? sources.find((n) => aliasSet.has(foldText(n.label)))
        ?? [...sources].sort((a, b) => size(b) - size(a)).find((n) => size(n) >= 20);
      let keptId: number;
      if (kept) {
        keptId = kept.id;
        const clash = db.prepare("SELECT id FROM niches WHERE label = ? COLLATE NOCASE AND id != ?").get(m.label, keptId) as { id: number } | undefined;
        if (clash && !sources.some((x) => x.id === clash.id)) throw new NicheError(`Le nom « ${m.label} » est déjà pris par une autre niche : renomme-la d'abord.`);
        if (clash) db.prepare("UPDATE niches SET label = label || ' (ancienne ' || id || ')' WHERE id = ?").run(clash.id);
        if (kept.label !== m.label) {
          addKw.run(keptId, foldText(kept.label));
          // Petite niche détaillée devenue la principale (ex. « Nail bar ») : son libellé reste en spécialité
          if (foldText(kept.label) !== fm && size(kept) < 20) {
            log.run(rid, keptId);
            db.prepare("UPDATE businesses SET specialite = ? WHERE niche_id = ? AND COALESCE(specialite, '') = ''").run(kept.label, keptId);
          }
          db.prepare("UPDATE niches SET label = ? WHERE id = ?").run(m.label, keptId);
        }
        db.prepare("UPDATE niches SET icon = CASE WHEN icon = 'tag' THEN ? ELSE icon END, archived = 0, position = ? WHERE id = ?").run(m.icon, mi + 1, keptId);
        db.prepare("UPDATE businesses SET niche = ? WHERE niche_id = ?").run(m.label, keptId);
      } else {
        const clash = db.prepare("SELECT id FROM niches WHERE label = ? COLLATE NOCASE").get(m.label) as { id: number } | undefined;
        if (clash) throw new NicheError(`Le nom « ${m.label} » est déjà pris par une autre niche : renomme-la d'abord.`);
        const color = nextColor(usedColors); usedColors.push(color);
        keptId = Number(db.prepare("INSERT INTO niches(label, color, icon, position, created_at) VALUES(?,?,?,?,?)").run(m.label, color, m.icon, ++pos, now()).lastInsertRowid);
        db.prepare("UPDATE niches SET position = ? WHERE id = ?").run(mi + 1, keptId);
        created++;
      }
      for (const a of aliasSet) if (a && a !== fm) addKw.run(keptId, a);
      for (const s of sources) {
        if (s.id === keptId) continue;
        log.run(rid, s.id);
        moved += move.run(s.label, keptId, m.label, s.id).changes;
        db.prepare("INSERT OR IGNORE INTO niche_maps(niche_id, kind, value) SELECT ?, kind, value FROM niche_maps WHERE niche_id = ?").run(keptId, s.id);
        addKw.run(keptId, foldText(s.label));
        db.prepare("DELETE FROM niches WHERE id = ?").run(s.id);
        remap.set(s.id, keptId); merged++;
      }
    }
    // Sans niche : la fiche perd sa niche, l'ancien libellé reste en spécialité
    for (const n of niches.filter((x) => assign[x.id] === "none")) {
      log.run(rid, n.id);
      const c = move.run(n.label, null, "", n.id).changes;
      moved += c; noNiche += c;
      db.prepare("DELETE FROM niches WHERE id = ?").run(n.id);
      remap.set(n.id, null); merged++;
    }
    remapIds((ids) => [...new Set(ids.flatMap((x) => (remap.has(x) ? (remap.get(x) == null ? [] : [remap.get(x)!]) : [x])))]);
    const seq = bumpNicheOps();
    const summary = { merged, moved, noNiche, created, mains: nMains };
    db.prepare("UPDATE niche_regroups SET summary = ?, ops_seq = ? WHERE id = ?").run(JSON.stringify(summary), seq, rid);
    return { id: rid, ...summary, backup };
  })();
}

/** Dernier regroupement et s'il peut encore être annulé. */
export function lastRegroup(): { id: number; at: string; summary: Record<string, number>; backup: string; canUndo: boolean; why: string } | null {
  const r = db.prepare("SELECT id, at, summary, ops_seq, backup, undone_at FROM niche_regroups ORDER BY id DESC LIMIT 1").get() as
    { id: number; at: string; summary: string; ops_seq: number; backup: string; undone_at: string | null } | undefined;
  if (!r) return null;
  const changed = nicheOpsSeq() !== r.ops_seq;
  return { id: r.id, at: r.at, summary: JSON.parse(r.summary || "{}"), backup: r.backup, canUndo: !r.undone_at && !changed,
    why: r.undone_at ? "déjà annulé" : changed ? "d'autres modifications de niches ont été faites depuis" : "" };
}

/** Annule le dernier regroupement : niches, correspondances, filtres et niche / spécialité de chaque fiche restaurés. */
export function undoRegroup(): { restored: number } {
  const last = lastRegroup();
  if (!last) throw new NicheError("Aucun regroupement à annuler.");
  if (!last.canUndo) throw new NicheError(`Annulation impossible : ${last.why}.`);
  const snap = JSON.parse((db.prepare("SELECT snapshot FROM niche_regroups WHERE id = ?").get(last.id) as { snapshot: string }).snapshot) as Snapshot;
  return db.transaction(() => {
    db.exec("DELETE FROM niche_maps; DELETE FROM niches;");
    for (const n of snap.niches) { const k = Object.keys(n); db.prepare(`INSERT INTO niches(${k.join(",")}) VALUES(${k.map(() => "?").join(",")})`).run(...k.map((x) => n[x])); }
    const im = db.prepare("INSERT OR IGNORE INTO niche_maps(niche_id, kind, value) VALUES(?,?,?)");
    for (const m of snap.maps) im.run(m.niche_id, m.kind, m.value);
    const restored = db.prepare(`UPDATE businesses SET niche_id = i.old_niche_id, niche = i.old_niche, specialite = i.old_specialite
      FROM niche_regroup_items i WHERE i.regroup_id = ? AND i.business_id = businesses.id`).run(last.id).changes;
    db.exec(`UPDATE businesses SET niche_id = NULL WHERE niche_id IS NOT NULL AND niche_id NOT IN (SELECT id FROM niches);
      UPDATE businesses SET niche = (SELECT label FROM niches WHERE id = businesses.niche_id) WHERE niche_id IS NOT NULL
        AND niche IS NOT (SELECT label FROM niches WHERE id = businesses.niche_id);`);
    if (snap.objectives != null) db.prepare("INSERT INTO settings(key, value) VALUES('objectives', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(snap.objectives);
    db.exec("DELETE FROM day_filters");
    const idf = db.prepare("INSERT INTO day_filters(day, filter, relances) VALUES(?,?,?)");
    for (const f of snap.dayFilters) idf.run(f.day, f.filter, f.relances);
    db.prepare("UPDATE niche_regroups SET undone_at = ? WHERE id = ?").run(now(), last.id);
    bumpNicheOps();
    return { restored };
  })();
}
