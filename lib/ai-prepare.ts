// Préparation IA des fiches (deux tâches séparées, toujours des PROPOSITIONS à valider sur la fiche) :
//  1. Analyse (JSON validé) : résumé, points d'amélioration (d'après les données), priorité 0-100 + raison ;
//  2. Message : premier WhatsApp en espagnol, court, {nom} remplacé, sans lien ni promesse inventée.
// File IA (ai_queue) traitée par un worker serveur, une fiche à la fois :
//  - s'arrête proprement si l'IA est hors ligne (la fiche reste en attente) et reprend quand elle revient ;
//  - ne retraite pas une fiche préparée depuis moins de 30 jours, sauf « Régénérer » ;
//  - « préparer chaque nuit la liste du lendemain » (heure America/Cancun, défaut 01:00) : nouveaux de la file du jour
//    (Ma journée / filtres par défaut, limite = objectif du jour), une seule fois par nuit.
// Aucune sortie de l'IA n'exécute d'action : rien n'est écrit dans la fiche ni envoyé sans clic (« Utiliser ce message »).
import { z } from "zod";
import { db, now, dayOf, addDays } from "./db";
import { getSetting, setSetting, criteria } from "./settings";
import { TZ } from "./constants";
import { getAiContext, freshlyDone, enqueueAi, aiQueueCounts } from "./ai-context";
import { buildAnalyseMessages, buildMessageMessages, finalizeDraft, AnalyseSchema, ANALYSE_JSON, MessageSchema, MESSAGE_JSON } from "./ai-prompt";
import { structured, iaParams, aiStatus, type LlmMsg } from "./llm";
import { todayQueue } from "./queue";

/** « /no_think » (Qwen3) à la fin du dernier message utilisateur : pas de longue phase de raisonnement. */
export const withNoThink = (msgs: LlmMsg[], on: boolean): LlmMsg[] => {
  const last = msgs.map((m) => m.role).lastIndexOf("user");
  return on && last >= 0 ? msgs.map((m, i) => (i === last ? { ...m, content: m.content + "\n/no_think" } as LlmMsg : m)) : msgs;
};

/** Analyse puis message pour une fiche. Résultat dans ai_outputs (statut, date, modèle). */
export async function prepareBusiness(id: number, opts: { regen?: boolean } = {}): Promise<"fait" | "deja_fait"> {
  if (!opts.regen && freshlyDone(id)) return "deja_fait";
  const ctx = getAiContext(id);
  if (!ctx) throw new Error("Commerce introuvable.");
  const p = iaParams();
  db.prepare("INSERT INTO ai_outputs(business_id, status) VALUES(?, 'en_cours') ON CONFLICT(business_id) DO UPDATE SET status = 'en_cours', error = ''").run(id);
  try {
    const a = await structured({
      task: "analyse", businessId: id, schema: AnalyseSchema, jsonSchema: ANALYSE_JSON, temperature: p.analyse.temperature, maxTokens: p.analyse.maxTokens,
      messages: withNoThink(buildAnalyseMessages(ctx, { contextTokens: p.contextTokens, criteria: criteria() }), p.noThink),
    });
    db.prepare("UPDATE ai_outputs SET summary = ?, improvements = ?, priority = ?, reason = ?, model = ? WHERE business_id = ?")
      .run(a.data.resume, JSON.stringify(a.data.ameliorations), a.data.priorite, a.data.raison, a.model, id);
    const m = await structured({
      task: "message", businessId: id, schema: MessageSchema, jsonSchema: MESSAGE_JSON, temperature: p.message.temperature, maxTokens: p.message.maxTokens,
      messages: withNoThink(buildMessageMessages(ctx, a.data, { style: getSetting("ia_style"), template: getSetting("tpl_first"), contextTokens: p.contextTokens }), p.noThink),
    });
    const draft = finalizeDraft(m.data.message, ctx.business.nom);
    if (draft.length < 10) throw new Error("Message proposé vide après nettoyage (liens retirés).");
    db.prepare("UPDATE ai_outputs SET status = 'fait', draft_message = ?, model = ?, error = '', at = ?, used_at = NULL WHERE business_id = ?").run(draft, m.model, now(), id);
    return "fait";
  } catch (e) {
    const online = (await aiStatus({ fresh: true }).catch(() => null))?.online;
    db.prepare("UPDATE ai_outputs SET status = ?, error = ? WHERE business_id = ?").run(online === false ? "a_faire" : "erreur", (e as Error).message.slice(0, 300), id);
    throw e;
  }
}

// ---------- Préparation de nuit ----------
export const NightSchema = z.object({ enabled: z.boolean().default(false), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "heure HH:MM").default("01:00") });
export type Night = z.infer<typeof NightSchema>;
export function nightSettings(): Night {
  let raw: unknown = {};
  try { raw = JSON.parse(getSetting("ia_night") || "{}"); } catch { raw = {}; }
  const r = NightSchema.safeParse(raw);
  return r.success ? r.data : NightSchema.parse({});
}
/** Jour et heure (HH:MM) à Cancún. */
export function cancunClock(d = new Date()): { day: string; hhmm: string } {
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return { day: dayOf(d), hhmm };
}
/** Nouveaux de la file du jour `day` (Ma journée ou filtres par défaut, fiches ajoutées à la main en tête), limite = objectif. */
export function nightIds(day: string): number[] {
  const q = todayQueue(day);
  return q.blocks.nouveaux.items.slice(0, Math.max(0, q.o.newGoal)).map((i) => i.b.id);
}
/**
 * À l'heure réglée (ou après, si le serveur était arrêté) : ajoute la liste du jour à la file IA, UNE fois par nuit.
 * Heure avant midi : la liste du jour même (01:00 → la journée qui commence) ; après midi : celle du lendemain.
 */
export function nightCheck(at = new Date()): { target: string; enqueued: number } | null {
  const cfg = nightSettings();
  if (!cfg.enabled) return null;
  const { day, hhmm } = cancunClock(at);
  if (hhmm < cfg.time || getSetting("ia_night_last") === day) return null;
  setSetting("ia_night_last", day);   // noté AVANT le travail : jamais deux fois la même nuit
  const target = cfg.time < "12:00" ? day : addDays(day, 1);
  const enqueued = enqueueAi(nightIds(target), { origin: "nuit" });
  console.log(`[bedolt-crm] IA de nuit : ${enqueued} fiche(s) ajoutée(s) à la file (liste du ${target})`);
  return { target, enqueued };
}

// ---------- Worker ----------
type WState = "idle" | "running" | "offline" | "unconfigured";
type W = { started: boolean; running: boolean; timer?: ReturnType<typeof setTimeout>; current: { id: number; nom: string } | null; busy: Set<number>; state: WState; message: string; lastError: string };
const g = globalThis as unknown as { __aiWorker?: W };
const S: W = (g.__aiWorker ??= { started: false, running: false, current: null, busy: new Set(), state: "idle", message: "", lastError: "" });
const RETRY_MS = 120_000;

function schedule(ms: number) { if (S.timer) clearTimeout(S.timer); S.timer = setTimeout(() => { void tickAi(); }, ms); S.timer.unref?.(); }
/** Relance le worker tout de suite (après un ajout manuel à la file). */
export function kickAi() { if (S.started && !S.running) schedule(50); }

/** Traite la file (une fiche à la fois) tant que l'IA est en ligne. Renvoie le nombre de fiches traitées. */
export async function tickAi(at = new Date()): Promise<number> {
  if (S.running) return 0;
  S.running = true;
  let n = 0, offline = false;
  try {
    try { nightCheck(at); } catch (e) { console.warn("[bedolt-crm] IA de nuit : impossible de préparer la liste", e); }
    const next = db.prepare(`SELECT q.business_id id, q.regen, q.attempts, b.nom FROM ai_queue q JOIN businesses b ON b.id = q.business_id
      WHERE q.done_at IS NULL AND q.next_try_at <= ? ORDER BY q.added_at, q.business_id LIMIT 1`);
    let checked = false;
    for (;;) {
      const row = next.get(Date.now()) as { id: number; regen: number; attempts: number; nom: string } | undefined;
      if (!row) { S.state = "idle"; S.message = ""; break; }
      if (S.busy.has(row.id)) { db.prepare("UPDATE ai_queue SET next_try_at = ? WHERE business_id = ?").run(Date.now() + 30_000, row.id); continue; }
      const st = await aiStatus({ fresh: !checked });
      checked = true;
      if (!st.online) { S.state = st.configured ? "offline" : "unconfigured"; S.message = st.message; offline = true; break; }
      S.state = "running"; S.current = { id: row.id, nom: row.nom };
      try {
        const r = await prepareBusiness(row.id, { regen: !!row.regen });
        db.prepare("UPDATE ai_queue SET done_at = ?, result = ? WHERE business_id = ?").run(now(), r, row.id);
        n++;
      } catch (e) {
        const st2 = await aiStatus({ fresh: true });
        if (!st2.online) { S.state = "offline"; S.message = st2.message; offline = true; break; }   // la fiche reste en attente
        S.lastError = `${row.nom} : ${(e as Error).message}`.slice(0, 300);
        const att = row.attempts + 1;
        if (att >= 2) db.prepare("UPDATE ai_queue SET done_at = ?, result = 'erreur', attempts = ? WHERE business_id = ?").run(now(), att, row.id);
        else db.prepare("UPDATE ai_queue SET attempts = ?, next_try_at = ? WHERE business_id = ?").run(att, Date.now() + RETRY_MS, row.id);
      } finally { S.current = null; }
    }
  } finally { S.running = false; S.current = null; }
  if (S.started) {
    const soon = (db.prepare("SELECT MIN(next_try_at) t FROM ai_queue WHERE done_at IS NULL").get() as { t: number | null }).t;
    schedule(offline || soon == null ? 60_000 : Math.min(60_000, Math.max(1000, soon - Date.now())));
  }
  return n;
}

/** « Générer » / « Régénérer » sur la fiche : tout de suite, sans attendre la file. */
export async function generateNow(id: number): Promise<void> {
  if (S.current?.id === id || S.busy.has(id)) throw new Error("Cette fiche est déjà en cours de préparation.");
  S.busy.add(id);
  try {
    await prepareBusiness(id, { regen: true });
    db.prepare("UPDATE ai_queue SET done_at = ?, result = 'fait' WHERE business_id = ? AND done_at IS NULL").run(now(), id);
  } finally { S.busy.delete(id); }
}

export function aiWorkerStatus() {
  const c = aiQueueCounts();
  const st = S.running || c.pending ? S.state : "idle";
  return { ...c, state: st, running: S.running, current: S.current ?? (S.busy.size ? { id: [...S.busy][0], nom: "" } : null),
    message: S.message, lastError: S.lastError, night: nightSettings(), nightLast: getSetting("ia_night_last") || null };
}

export function startAiWorker() {
  if (process.env.AI_WORKER === "off" || S.started) return;
  S.started = true;
  schedule(15_000);
  console.log("[bedolt-crm] IA : worker de préparation démarré (file IA, préparation de nuit)");
}
