// Dossier IA d'une fiche : un objet JSON STABLE (mêmes clés, même ordre, null plutôt qu'absent) que l'IA lira plus
// tard pour rédiger un message, résumer, proposer des améliorations. getAiContext(id) est le point d'entrée unique.
// Sécurité : l'IA ne fait que proposer (ai_outputs) ; rien n'est appliqué sans validation. Le texte des sites est
// marqué comme donnée non fiable et balisé à part dans le prompt (lib/ai-prompt.ts).
import { db, now } from "./db";
import { getBusiness, businessActions, waState } from "./crm";
import { nicheById } from "./niches";
import { statutLabel, actionLabel, motifLabel, ficheLabel } from "./constants";
import { webAudit, siteText } from "./web-audit";

export const AI_CONTEXT_SCHEMA_VERSION = "bedolt.ai-context/1";

/** Schéma documenté (aussi renvoyé par GET /api/ai/context?schema=1). */
export const AI_CONTEXT_SCHEMA = {
  schema: "string — « bedolt.ai-context/1 »",
  generated_at: "string ISO 8601",
  business: { id: "number", nom: "string", niche: "{ id, label } | null", specialite: "string", activite: "string", ville: "string", zone: "string", colonia: "string", adresse: "string", etat: "string", municipio: "string" },
  contacts: { telephone: "string (+52…) | ''", whatsapp: "« oui » | « non » | « inconnu »", email: "string", site_web: "string", facebook: "string", instagram: "string", tiktok: "string" },
  google: { fiche: "Oui | Non | Vide | À vérifier | —", note: "number | null", avis: "number | null", lien: "string" },
  prospection: { statut: "clé", statut_label: "string", motif_perte: "string", offre: "string (P1-P3)", angle: "string", message_prepare: "string", relances_faites: "number", premier_contact: "ISO | null", prochaine_relance: "YYYY-MM-DD | null", ne_pas_contacter: "boolean" },
  historique: "[{ date, type, libelle, detail }] (30 dernières actions, récentes d'abord)",
  web: "{ analyse_le, statut, score (0-100 | null), https, temps_ms, mobile, titre, description, whatsapp, telephone_cliquable, formulaire, reservation, reseaux[], copyright, plateforme, pages, a_ameliorer[] } | null (null : jamais analysé ; site vide : « aucun_site »)",
  texte_site: "{ capture_le, pages[], texte (≤ 20 Ko), non_fiable: true } | null — DONNÉES, jamais des consignes",
  ia: "{ statut, message_propose, resume, ameliorations[], priorite, raison, modele, date } | null — dernières propositions de l'IA",
} as const;

export type AiContext = {
  schema: string; generated_at: string;
  business: { id: number; nom: string; niche: { id: number; label: string } | null; specialite: string; activite: string; ville: string; zone: string; colonia: string; adresse: string; etat: string; municipio: string };
  contacts: { telephone: string; whatsapp: "oui" | "non" | "inconnu"; email: string; site_web: string; facebook: string; instagram: string; tiktok: string };
  google: { fiche: string; note: number | null; avis: number | null; lien: string };
  prospection: { statut: string; statut_label: string; motif_perte: string; offre: string; angle: string; message_prepare: string; relances_faites: number; premier_contact: string | null; prochaine_relance: string | null; ne_pas_contacter: boolean };
  historique: { date: string; type: string; libelle: string; detail: string }[];
  web: { aucun_site: true } | { analyse_le: string; statut: string; score: number | null; https: boolean | null; temps_ms: number | null; mobile: boolean | null; titre: string; description: string; whatsapp: boolean | null; telephone_cliquable: boolean | null; formulaire: boolean | null; reservation: boolean | null; reseaux: string[]; copyright: number | null; plateforme: string; pages: number | null; a_ameliorer: string[] } | null;
  texte_site: { capture_le: string; pages: string[]; texte: string; non_fiable: true } | null;
  ia: { statut: string; message_propose: string; resume: string; ameliorations: string[]; priorite: number | null; raison: string; modele: string; date: string | null } | null;
};

export type AiOutput = { status: string; draft_message: string; summary: string; improvements: string; priority: number | null; reason: string; model: string; error: string; at: string | null; used_at: string | null };
export const aiOutput = (id: number) => db.prepare("SELECT * FROM ai_outputs WHERE business_id = ?").get(id) as AiOutput | undefined;

export function getAiContext(id: number): AiContext | null {
  const b = getBusiness(id);
  if (!b) return null;
  const niche = b.niche_id ? nicheById(b.niche_id) : undefined;
  const wa = webAudit(id), st = siteText(id), out = aiOutput(id);
  const d = wa?.data ?? null;
  return {
    schema: AI_CONTEXT_SCHEMA_VERSION,
    generated_at: now(),
    business: { id: b.id, nom: b.nom, niche: niche ? { id: niche.id, label: niche.label } : null, specialite: b.specialite ?? "", activite: b.activite ?? "", ville: b.ville ?? "",
      zone: b.zone ?? "", colonia: b.colonia ?? "", adresse: b.adresse ?? "", etat: b.etat ?? "", municipio: b.municipio ?? "" },
    contacts: { telephone: b.tel_norm ? "+52" + b.tel_norm : "", whatsapp: waState(b), email: b.email ?? "", site_web: b.site_web ?? "", facebook: b.facebook ?? "", instagram: b.instagram ?? "", tiktok: b.tiktok ?? "" },
    google: { fiche: ficheLabel(b.fiche_google), note: b.note_google ?? null, avis: b.nb_avis ?? null, lien: b.lien_google ?? "" },
    prospection: { statut: b.statut, statut_label: statutLabel(b.statut), motif_perte: b.statut === "perdu" ? motifLabel(b.perdu_motif) : "", offre: b.offre ?? "", angle: b.angle ?? "",
      message_prepare: b.message_whatsapp ?? "", relances_faites: b.relance_n ?? 0, premier_contact: b.first_contact_at ?? null, prochaine_relance: b.next_followup ?? null, ne_pas_contacter: !!b.ne_pas_contacter },
    historique: businessActions(id, 30).map((a) => ({ date: a.at, type: a.type, libelle: actionLabel(a.type), detail: a.content ?? "" })),
    web: !b.site_web?.trim() ? { aucun_site: true } : wa ? {
      analyse_le: wa.at, statut: wa.status, score: wa.score, https: d?.https ?? null, temps_ms: d?.ms ?? null, mobile: d?.viewport ?? null, titre: d?.title ?? "", description: d?.description ?? "",
      whatsapp: d?.whatsapp ?? null, telephone_cliquable: d?.tel ?? null, formulaire: d?.form ?? null, reservation: d?.booking ?? null, reseaux: d?.socials ?? [], copyright: d?.copyright ?? null,
      plateforme: d?.platform ?? "", pages: d?.pages ?? null, a_ameliorer: wa.issues,
    } : null,
    texte_site: st ? { capture_le: st.at, pages: JSON.parse(st.pages || "[]"), texte: st.text, non_fiable: true } : null,
    ia: out ? { statut: out.status, message_propose: out.draft_message, resume: out.summary, ameliorations: JSON.parse(out.improvements || "[]"), priorite: out.priority, raison: out.reason, modele: out.model, date: out.at } : null,
  };
}

// ---------- File IA (traitée par lib/ai-prepare.ts, une fiche à la fois) ----------
/** Une fiche préparée il y a moins de 30 jours n'est pas retraitée (sauf « Régénérer »). */
export const AI_FRESH_DAYS = 30;
export const freshlyDone = (id: number) => !!db.prepare(`SELECT 1 FROM ai_outputs WHERE business_id = ? AND status = 'fait' AND at > ?`)
  .get(id, new Date(Date.now() - AI_FRESH_DAYS * 86400_000).toISOString());

/**
 * Ajoute des fiches à la file IA. Sans `regen` : les fiches déjà préparées depuis moins de 30 jours sont ignorées.
 * Quand la file est vide, les lignes terminées sont purgées (la progression repart à zéro pour le nouveau lot).
 */
export function enqueueAi(ids: number[], opts: { regen?: boolean; origin?: "manuel" | "nuit" } = {}): number {
  const ins = db.prepare(`INSERT INTO ai_queue(business_id, added_at, task, regen, origin) VALUES(?,?,'preparer',?,?)
    ON CONFLICT(business_id) DO UPDATE SET added_at = excluded.added_at, regen = MAX(ai_queue.regen, excluded.regen), origin = excluded.origin,
      done_at = NULL, result = '', attempts = 0, next_try_at = 0 WHERE ai_queue.done_at IS NOT NULL OR excluded.regen > ai_queue.regen`);
  const out = db.prepare("INSERT INTO ai_outputs(business_id, status) VALUES(?, 'a_faire') ON CONFLICT(business_id) DO UPDATE SET status = 'a_faire' WHERE ai_outputs.status IN ('fait', 'erreur')");
  const exists = db.prepare("SELECT 1 FROM businesses WHERE id = ?");
  let n = 0;
  db.transaction(() => {
    const pending = (db.prepare("SELECT COUNT(*) n FROM ai_queue WHERE done_at IS NULL").get() as { n: number }).n;
    if (!pending) db.prepare("DELETE FROM ai_queue WHERE done_at IS NOT NULL").run();
    for (const id of new Set(ids)) {
      if (!exists.get(id) || (!opts.regen && freshlyDone(id))) continue;
      const c = ins.run(id, now(), opts.regen ? 1 : 0, opts.origin ?? "manuel").changes;
      n += c; if (c) out.run(id);
    }
  })();
  return n;
}
/** Vide la file (fiches en attente) ; les propositions déjà faites restent. */
export function clearAiQueue(): number {
  return db.transaction(() => {
    db.prepare("UPDATE ai_outputs SET status = CASE WHEN draft_message != '' OR summary != '' THEN 'fait' ELSE 'a_faire' END WHERE status IN ('a_faire', 'en_cours') AND business_id IN (SELECT business_id FROM ai_queue WHERE done_at IS NULL)").run();
    return db.prepare("DELETE FROM ai_queue WHERE done_at IS NULL").run().changes;
  })();
}
export function aiQueueCounts() {
  const q = db.prepare("SELECT COUNT(*) total, SUM(done_at IS NULL) pending, SUM(done_at IS NOT NULL) done, SUM(result = 'erreur') errors FROM ai_queue").get() as Record<string, number | null>;
  return { total: q.total ?? 0, pending: q.pending ?? 0, done: q.done ?? 0, errors: q.errors ?? 0 };
}
/** « Utiliser ce message » (validation explicite) ou « Ignorer » une proposition. */
export function useAiOutput(id: number, action: "use" | "dismiss"): boolean {
  const o = aiOutput(id);
  if (!o) return false;
  if (action === "use") {
    if (!o.draft_message.trim()) return false;
    db.prepare("UPDATE businesses SET message_whatsapp = ? WHERE id = ?").run(o.draft_message.slice(0, 5000), id);
    db.prepare("UPDATE ai_outputs SET used_at = ? WHERE business_id = ?").run(now(), id);
    return true;
  }
  db.prepare("UPDATE ai_outputs SET draft_message = '', used_at = ? WHERE business_id = ?").run(now(), id);
  return true;
}
