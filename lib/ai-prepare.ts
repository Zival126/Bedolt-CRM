// Préparation IA des fiches (deux tâches séparées, toujours des PROPOSITIONS à valider sur la fiche) :
//  1. Analyse (JSON validé) : résumé, points d'amélioration (d'après les données), priorité 0-100 + raison ;
//  2. Message : premier WhatsApp en espagnol, court, {nom} remplacé, sans lien ni promesse inventée.
// File IA (ai_queue) traitée par un worker serveur, une fiche à la fois :
//  - s'arrête proprement si l'IA est hors ligne (la fiche reste en attente) et reprend quand elle revient ;
//  - ne retraite pas une fiche préparée depuis moins de 30 jours, sauf « Régénérer » ;
//  - « préparer chaque nuit la liste du lendemain » (heure America/Cancun, défaut 01:00) : nouveaux de la file du jour
//    (Ma journée / filtres par défaut, limite = objectif du jour), une seule fois par nuit.
// « Générer » sur la fiche passe aussi par cette file (en tête, en arrière-plan) : le navigateur n'attend jamais.
// Délais : « délai max par génération » (600 s file / nuit, 300 s « Générer »), inactivité réglable ; tout en streaming.
// Aucune sortie de l'IA n'exécute d'action : rien n'est écrit dans la fiche ni envoyé sans clic (« Utiliser ce message »).
import { z } from "zod";
import { db, now, dayOf, addDays } from "./db";
import { getSetting, setSetting, criteria } from "./settings";
import { TZ } from "./constants";
import { getAiContext, freshlyDone, enqueueAi, aiQueueCounts } from "./ai-context";
import { buildAnalyseMessages, buildMessageMessages, finalizeDraft, AnalyseSchema, ANALYSE_JSON, MessageSchema, MESSAGE_JSON } from "./ai-prompt";
import { structured, iaParams, aiStatus, type LlmMsg, type Progress } from "./llm";
import { todayQueue } from "./queue";

/** « /no_think » (Qwen3) à la fin du dernier message utilisateur : pas de longue phase de raisonnement. */
export const withNoThink = (msgs: LlmMsg[], on: boolean): LlmMsg[] => {
  const last = msgs.map((m) => m.role).lastIndexOf("user");
  return on && last >= 0 ? msgs.map((m, i) => (i === last ? { ...m, content: m.content + "\n/no_think" } as LlmMsg : m)) : msgs;
};

export type PrepOpts = { regen?: boolean; deadlineMs?: number; onProgress?: (task: "analyse" | "message", p: Progress) => void };
/** Analyse puis message pour une fiche. Résultat dans ai_outputs (statut, date, modèle). */
export async function prepareBusiness(id: number, opts: PrepOpts = {}): Promise<"fait" | "deja_fait"> {
  if (!opts.regen && freshlyDone(id)) return "deja_fait";
  const ctx = getAiContext(id);
  if (!ctx) throw new Error("Commerce introuvable.");
  const p = iaParams();
  const common = { businessId: id, deadlineMs: opts.deadlineMs ?? p.genTimeoutS * 1000, idleMs: undefined, reasoningOff: p.noThink };
  db.prepare("INSERT INTO ai_outputs(business_id, status) VALUES(?, 'en_cours') ON CONFLICT(business_id) DO UPDATE SET status = 'en_cours', error = ''").run(id);
  try {
    const a = await structured({
      ...common, task: "analyse", onProgress: (q) => opts.onProgress?.("analyse", q), schema: AnalyseSchema, jsonSchema: ANALYSE_JSON, temperature: p.analyse.temperature, maxTokens: p.analyse.maxTokens,
      messages: withNoThink(buildAnalyseMessages(ctx, { contextTokens: p.contextTokens, criteria: criteria() }), p.noThink),
    });
    db.prepare("UPDATE ai_outputs SET summary = ?, improvements = ?, priority = ?, reason = ?, model = ? WHERE business_id = ?")
      .run(a.data.resume, JSON.stringify(a.data.ameliorations), a.data.priorite, a.data.raison, a.model, id);
    const m = await structured({
      ...common, task: "message", onProgress: (q) => opts.onProgress?.("message", q), schema: MessageSchema, jsonSchema: MESSAGE_JSON, temperature: p.message.temperature, maxTokens: p.message.maxTokens,
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
export type Current = { id: number; nom: string; origin: string; task: "analyse" | "message"; tokens: number; reasoning: number; startedAt: number };
type W = { started: boolean; running: boolean; timer?: ReturnType<typeof setTimeout>; current: Current | null; state: WState; message: string; lastError: string };
const g = globalThis as unknown as { __aiWorker?: W };
const S: W = (g.__aiWorker ??= { started: false, running: false, current: null, state: "idle", message: "", lastError: "" });
const RETRY_MS = 120_000;

function schedule(ms: number) { if (S.timer) clearTimeout(S.timer); S.timer = setTimeout(() => { void tickAi(); }, ms); S.timer.unref?.(); }
/** Relance le worker tout de suite (après un ajout à la file). */
export function kickAi() { if (S.started && !S.running) schedule(50); }

/** Traite la file (une fiche à la fois, « Générer » de la fiche en tête) tant que l'IA est en ligne. */
export async function tickAi(at = new Date()): Promise<number> {
  if (S.running) return 0;
  S.running = true;
  let n = 0, offline = false;
  try {
    try { nightCheck(at); } catch (e) { console.warn("[bedolt-crm] IA de nuit : impossible de préparer la liste", e); }
    const next = db.prepare(`SELECT q.business_id id, q.regen, q.attempts, q.origin, b.nom FROM ai_queue q JOIN businesses b ON b.id = q.business_id
      WHERE q.done_at IS NULL AND q.next_try_at <= ? ORDER BY (q.origin = 'fiche') DESC, q.added_at, q.business_id LIMIT 1`);
    let checked = false;
    for (;;) {
      const row = next.get(Date.now()) as { id: number; regen: number; attempts: number; origin: string; nom: string } | undefined;
      if (!row) { S.state = "idle"; S.message = ""; break; }
      const st = await aiStatus({ fresh: !checked });
      checked = true;
      if (!st.online) { S.state = st.configured ? "offline" : "unconfigured"; S.message = st.message; offline = true; break; }
      const p = iaParams();
      const manual = row.origin === "fiche";
      S.state = "running";
      S.current = { id: row.id, nom: row.nom, origin: row.origin, task: "analyse", tokens: 0, reasoning: 0, startedAt: Date.now() };
      try {
        const r = await prepareBusiness(row.id, { regen: !!row.regen, deadlineMs: (manual ? p.manualTimeoutS : p.genTimeoutS) * 1000,
          onProgress: (task, q) => { if (S.current) { if (S.current.task !== task) S.current.startedAt = Date.now(); S.current.task = task; S.current.tokens = q.tokens; S.current.reasoning = q.reasoning; } } });
        db.prepare("UPDATE ai_queue SET done_at = ?, result = ? WHERE business_id = ?").run(now(), r, row.id);
        n++;
      } catch (e) {
        const st2 = await aiStatus({ fresh: true });
        if (!st2.online) { S.state = "offline"; S.message = st2.message; offline = true; break; }   // la fiche reste en attente
        S.lastError = `${row.nom} : ${(e as Error).message}`.slice(0, 300);
        const att = row.attempts + 1;
        // « Générer » (fiche) : un seul essai, l'erreur s'affiche sur la fiche ; file / nuit : 2 essais
        if (manual || att >= 2) db.prepare("UPDATE ai_queue SET done_at = ?, result = 'erreur', attempts = ? WHERE business_id = ?").run(now(), att, row.id);
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

/**
 * « Générer » / « Régénérer » sur la fiche : mise en TÊTE de la file, traitée en arrière-plan (le navigateur n'attend pas ;
 * la fiche suit la progression via ficheAiState).
 */
export function requestGenerate(id: number): { queued: boolean; already: boolean } {
  if (S.current?.id === id) return { queued: false, already: true };
  const n = enqueueAi([id], { regen: true, origin: "fiche" });
  kickAi();
  return { queued: n > 0 || !!db.prepare("SELECT 1 FROM ai_queue WHERE business_id = ? AND done_at IS NULL").get(id), already: false };
}

/** État de préparation d'une fiche (pour l'affichage « génération en cours… X tokens reçus »). */
export function ficheAiState(id: number) {
  const q = db.prepare("SELECT done_at, result, origin FROM ai_queue WHERE business_id = ?").get(id) as { done_at: string | null; result: string; origin: string } | undefined;
  const pending = !!q && !q.done_at;
  const ahead = pending ? (db.prepare(`SELECT COUNT(*) n FROM ai_queue WHERE done_at IS NULL AND business_id != ? AND ((origin = 'fiche') > (? = 'fiche')
    OR ((origin = 'fiche') = (? = 'fiche') AND added_at < (SELECT added_at FROM ai_queue WHERE business_id = ?)))`).get(id, q!.origin, q!.origin, id) as { n: number }).n : 0;
  const cur = S.current?.id === id ? S.current : null;
  return {
    pending, running: !!cur, ahead: cur ? 0 : ahead,
    task: cur?.task ?? null, tokens: cur?.tokens ?? 0, reasoning: cur?.reasoning ?? 0, elapsedS: cur ? Math.round((Date.now() - cur.startedAt) / 1000) : 0,
    worker: S.state, message: S.message, lastResult: q?.done_at ? q.result : null,
  };
}

export function aiWorkerStatus() {
  const c = aiQueueCounts();
  const st = S.running || c.pending ? S.state : "idle";
  const cur = S.current ? { ...S.current, elapsedS: Math.round((Date.now() - S.current.startedAt) / 1000) } : null;
  return { ...c, state: st, running: S.running, current: cur, message: S.message, lastError: S.lastError, night: nightSettings(), nightLast: getSetting("ia_night_last") || null };
}

export function startAiWorker() {
  if (process.env.AI_WORKER === "off" || S.started) return;
  S.started = true;
  schedule(15_000);
  console.log("[bedolt-crm] IA : worker de préparation démarré (file IA, préparation de nuit)");
}
