// Résultats en 1 clic : chaque bouton = une transition du cycle de vie + une ligne de journal (date, type, résultat, étape).
// Tout se fait dans une transaction, avec un instantané de la fiche pour « Annuler » (toast 10 s).
import { db, now, today, addDays, dayOf } from "./db";
import { getBusiness, setStatus, logAction, dayCounts, type Business } from "./crm";
import { MOTIFS, motifLabel } from "./constants";
import { objectives } from "./settings";
import { stageOf, STEP_OF, type Result } from "./stage";
import { waNumber } from "./phone";
import { HttpError } from "./session";

export type ResultInput = {
  id: number; result: Result;
  template?: "first" | "j2" | "j7";       // wa_sent
  canal?: "whatsapp" | "appel";           // repondu / pas_repondu
  motif?: string; detail?: string;        // perdu (detail : texte libre pour « Autre »)
  next_step?: string; date?: string;      // interesse / etape / rappel (YYYY-MM-DD)
  toCall?: boolean;                       // no_wa : false = Perdu (injoignable)
};

/** Colonnes restaurées par « Annuler ». */
const SNAP = ["statut", "statut_date", "first_contact_at", "next_followup", "relance_n", "next_step", "next_date", "perdu_motif", "no_whatsapp"] as const;
const UNDO_MS = 10 * 60_000; // le toast dure 10 s ; marge côté serveur (réseau lent, téléphone en veille)

const maxId = (t: "actions" | "status_history") => (db.prepare(`SELECT COALESCE(MAX(id),0) m FROM ${t}`).get() as { m: number }).m;
const fmtDay = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

function update(id: number, sets: Record<string, unknown>) {
  const k = Object.keys(sets);
  if (k.length) db.prepare(`UPDATE businesses SET ${k.map((x) => `${x}=?`).join(", ")} WHERE id=?`).run(...k.map((x) => sets[x]), id);
}

/** Applique un résultat. Lève HttpError (message affiché à l'utilisateur) si l'action n'a pas de sens pour cette fiche. */
export function applyResult(input: ResultInput): { undo: number; message: string; business: Business; follow?: "reponse" | "interesse" } {
  return db.transaction(() => {
    const b = getBusiness(input.id);
    if (!b) throw new HttpError(404, "Commerce introuvable.");
    const day = today();
    const st = stageOf(b);
    const step = STEP_OF[st];
    const snapshot = Object.fromEntries(SNAP.map((k) => [k, b[k]]));
    const a0 = maxId("actions"), h0 = maxId("status_history");
    const hadClient = !!db.prepare("SELECT 1 FROM clients WHERE business_id=?").get(b.id);
    const closed = b.statut === "perdu" || b.statut === "paye";
    const needOpen = () => { if (b.statut === "perdu") throw new HttpError(400, "Fiche perdue : réactive-la d'abord."); };
    let message = "";
    let follow: "reponse" | "interesse" | undefined;
    const log = (type: string, content = "") => logAction(b.id, type, content, step, input.result);

    switch (input.result) {
      case "wa_sent": {
        needOpen();
        if (!waNumber(b.whatsapp || b.telephone)) throw new HttpError(400, "Numéro mexicain invalide ou manquant.");
        const tpl = input.template ?? (st === "new" ? "first" : st === "j2" ? "j2" : "j7");
        if (tpl === "first" && b.statut === "a_contacter") {
          const o = objectives();
          if (dayCounts(day).newWa >= o.newHard) throw new HttpError(429, `Limite dure atteinte : ${o.newHard} nouveaux WhatsApp aujourd'hui (Réglages > Objectifs). Rien n'est enregistré.`);
        }
        const label = b.statut === "a_contacter" || b.statut === "contacte" ? { first: "Premier message", j2: "Relance J+2", j7: "Relance J+7" }[tpl] : "Message (conversation)";
        logAction(b.id, "whatsapp", label, step, "wa_sent");
        update(b.id, { no_whatsapp: 0 });
        if (b.statut === "a_contacter") {
          setStatus(b.id, "contacte");
          update(b.id, { first_contact_at: now(), relance_n: 0, next_followup: addDays(day, 2) });
          message = "WhatsApp envoyé · relance J+2 le " + fmtDay(addDays(day, 2));
        } else if (b.statut === "contacte") {
          message = advanceRelance(b, day);
        } else message = "WhatsApp envoyé";
        break;
      }
      case "no_wa": {
        needOpen();
        update(b.id, { no_whatsapp: 1 });
        if (input.toCall === false) {
          log("no_whatsapp", "→ Perdu (injoignable)");
          setStatus(b.id, "perdu", "injoignable");
          message = "Perdu · pas de WhatsApp / injoignable";
        } else {
          log("no_whatsapp", "→ À appeler");
          message = "Numéro sans WhatsApp · ajouté à « À appeler »";
        }
        break;
      }
      case "repondu": {
        needOpen();
        if (b.statut === "paye") throw new HttpError(400, "Déjà client.");
        log(input.canal === "appel" ? "appel_repondu" : "repondu");
        if (b.statut === "a_contacter" || b.statut === "contacte") setStatus(b.id, "a_repondu");
        update(b.id, { next_followup: null, next_date: null });
        message = "A répondu · relances annulées";
        follow = "reponse";
        break;
      }
      case "pas_repondu": {
        needOpen();
        if (closed) throw new HttpError(400, "Fiche déjà close.");
        log(input.canal === "appel" ? "appel_pas_repondu" : "pas_repondu");
        if (b.statut === "a_contacter") {
          setStatus(b.id, "contacte");
          update(b.id, { first_contact_at: now(), relance_n: 0, next_followup: addDays(day, 2) });
          message = "Pas répondu · relance J+2 le " + fmtDay(addDays(day, 2));
        } else if (b.statut === "contacte") {
          message = advanceRelance(b, day, true);
        } else {
          // À rappeler / étape prévue : on réessaie demain
          update(b.id, { next_date: addDays(day, 1) });
          message = "Pas répondu · à rappeler demain";
        }
        break;
      }
      case "interesse": {
        needOpen();
        if (b.statut === "paye") throw new HttpError(400, "Déjà client.");
        const ns = (input.next_step ?? "").trim();
        log("interesse", [ns, input.date ? "le " + input.date : ""].filter(Boolean).join(" · "));
        if (b.statut !== "interesse") setStatus(b.id, "interesse");
        update(b.id, { next_followup: null, next_step: ns, next_date: input.date || null });
        message = "Intéressé 🎯";
        follow = "interesse";
        break;
      }
      case "etape": {
        needOpen();
        const ns = (input.next_step ?? "").trim();
        if (!ns && !input.date) throw new HttpError(400, "Indique une prochaine étape ou une date.");
        log("etape", [ns, input.date ? "le " + input.date : ""].filter(Boolean).join(" · "));
        update(b.id, { next_step: ns, next_date: input.date || null });
        message = "Prochaine étape enregistrée";
        break;
      }
      case "rappel": {
        needOpen();
        if (!input.date) throw new HttpError(400, "Choisis la date du rappel.");
        if (input.date < day) throw new HttpError(400, "La date du rappel est déjà passée.");
        log("rappel", "le " + input.date);
        if (b.statut === "a_contacter" || b.statut === "contacte") setStatus(b.id, "a_repondu");
        update(b.id, { next_followup: null, next_date: input.date });
        message = "À rappeler le " + fmtDay(input.date);
        break;
      }
      case "perdu": {
        const motif = input.motif ?? "";
        if (!MOTIFS.some((m) => m.key === motif)) throw new HttpError(400, "Choisis un motif.");
        if (b.statut === "perdu") throw new HttpError(400, "Déjà perdue.");
        const detail = (input.detail ?? "").trim();
        log("perdu", motifLabel(motif) + (detail ? " — " + detail : ""));
        setStatus(b.id, "perdu", motif);
        update(b.id, { next_followup: null, next_date: null, ...(motif === "injoignable" ? { no_whatsapp: 1 } : {}) });
        message = "Perdu · " + motifLabel(motif);
        break;
      }
      case "reactiver": {
        if (b.statut !== "perdu") throw new HttpError(400, "Cette fiche n'est pas perdue.");
        // Statut d'avant la perte (historique), sinon À contacter
        const prev = db.prepare("SELECT statut FROM status_history WHERE business_id=? AND statut NOT IN ('perdu','pas_interesse') ORDER BY at DESC, id DESC LIMIT 1").get(b.id) as { statut: string } | undefined;
        const to = prev && prev.statut !== "paye" ? prev.statut : "a_contacter";
        log("reactive", "→ " + to);
        setStatus(b.id, to);
        if (to === "contacte") update(b.id, { next_followup: day });
        message = "Fiche réactivée";
        break;
      }
      case "paye": {
        if (b.statut === "paye") throw new HttpError(400, "Déjà client.");
        needOpen();
        log("paye");
        setStatus(b.id, "paye");
        update(b.id, { next_followup: null, next_date: null });
        message = "Payé 🎉 · fiche client créée";
        break;
      }
      case "reporter": {
        if (b.statut !== "contacte") throw new HttpError(400, "Seule une relance peut être reportée.");
        log("reporte", "+7 jours");
        update(b.id, { next_followup: addDays(day, 7) });
        message = "Relance reportée au " + fmtDay(addDays(day, 7));
        break;
      }
    }

    // La fiche sort de la file du jour (elle n'y revient pas aujourd'hui, même si elle reste éligible).
    const queued = db.prepare("SELECT id FROM daily_queue WHERE day=? AND business_id=? AND done_at IS NULL").all(day, b.id) as { id: number }[];
    if (queued.length) db.prepare(`UPDATE daily_queue SET done_at=? WHERE id IN (${queued.map(() => "?").join(",")})`).run(now(), ...queued.map((q) => q.id));

    const ids = (t: "actions" | "status_history", from: number) =>
      (db.prepare(`SELECT id FROM ${t} WHERE id > ? AND business_id = ?`).all(from, b.id) as { id: number }[]).map((r) => r.id);
    const clientCreated = !hadClient && !!db.prepare("SELECT 1 FROM clients WHERE business_id=?").get(b.id);
    const undo = Number(db.prepare("INSERT INTO undo_log(business_id, snapshot, action_ids, history_ids, queue_ids, client_created, at) VALUES(?,?,?,?,?,?,?)")
      .run(b.id, JSON.stringify(snapshot), JSON.stringify(ids("actions", a0)), JSON.stringify(ids("status_history", h0)),
        JSON.stringify(queued.map((q) => q.id)), clientCreated ? 1 : 0, Date.now()).lastInsertRowid);
    return { undo, message, business: getBusiness(b.id)!, follow };
  })();
}

/** Relance suivante : J+2 faite → J+7 ; J+7 faite → « sans réponse » (Perdu proposé dans la file 3 jours plus tard). */
function advanceRelance(b: Business, day: string, noAnswer = false): string {
  const first = b.first_contact_at ? dayOf(new Date(b.first_contact_at)) : day; // jour local (Cancún), pas la date UTC
  const n = b.relance_n ?? 0;
  const later = (d: string, min: number) => (d > addDays(day, min) ? d : addDays(day, min));
  const pre = noAnswer ? "Pas de réponse" : "Relance envoyée";
  if (n <= 0) {
    const due = later(addDays(first, 7), 2);
    update(b.id, { relance_n: 1, next_followup: due });
    return `${pre} · relance J+7 le ${fmtDay(due)}`;
  }
  const due = addDays(day, 3);
  update(b.id, { relance_n: 2, next_followup: due });
  return `${pre} · sans réponse ? Perdu proposé le ${fmtDay(due)}`;
}

/** Annule un résultat (dans les 10 min, et seulement le plus récent de la fiche). */
export function undoResult(undoId: number): { message: string } {
  return db.transaction(() => {
    const u = db.prepare("SELECT * FROM undo_log WHERE id=?").get(undoId) as
      { id: number; business_id: number; snapshot: string; action_ids: string; history_ids: string; queue_ids: string; client_created: number; at: number; undone_at: number | null } | undefined;
    if (!u) throw new HttpError(404, "Rien à annuler.");
    if (u.undone_at) throw new HttpError(400, "Déjà annulé.");
    if (Date.now() - u.at > UNDO_MS) throw new HttpError(400, "Trop tard pour annuler (10 min max).");
    const later = db.prepare("SELECT 1 FROM undo_log WHERE business_id=? AND id>? AND undone_at IS NULL").get(u.business_id, u.id);
    if (later) throw new HttpError(409, "Une action plus récente existe sur cette fiche : annule-la d'abord.");
    if (!getBusiness(u.business_id)) throw new HttpError(404, "Commerce introuvable.");
    const snap = JSON.parse(u.snapshot) as Record<string, unknown>;
    update(u.business_id, Object.fromEntries(SNAP.map((k) => [k, snap[k] ?? null])));
    const del = (t: string, ids: number[]) => { if (ids.length) db.prepare(`DELETE FROM ${t} WHERE business_id=? AND id IN (${ids.map(() => "?").join(",")})`).run(u.business_id, ...ids); };
    del("actions", JSON.parse(u.action_ids));
    del("status_history", JSON.parse(u.history_ids));
    if (u.client_created) db.prepare("DELETE FROM clients WHERE business_id=?").run(u.business_id);
    const q = JSON.parse(u.queue_ids) as number[];
    if (q.length) db.prepare(`UPDATE daily_queue SET done_at=NULL WHERE id IN (${q.map(() => "?").join(",")})`).run(...q);
    db.prepare("UPDATE undo_log SET undone_at=? WHERE id=?").run(Date.now(), u.id);
    // purge : on ne garde que 7 jours d'annulations
    db.prepare("DELETE FROM undo_log WHERE at < ?").run(Date.now() - 7 * 86400_000);
    return { message: "Action annulée" };
  })();
}
