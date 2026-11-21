import { db } from "./db";
import { getBusiness, listBusinesses, businessActions, businessHistory, pipelineCounts, weekStats, logAction } from "./crm";
import { statutLabel } from "./constants";
import { today, addDays } from "./db";

// Schéma des outils au format Ollama (OpenAI-compatible).
const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) =>
  ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });

export const TOOLS = [
  fn("search_businesses", "Cherche des commerces dans le CRM avec des filtres. Retourne une liste courte.", {
    q: { type: "string", description: "Texte dans le nom ou le téléphone" },
    ville: { type: "string" }, activite: { type: "string" }, niche: { type: "string" }, zone: { type: "string" },
    offre: { type: "string", description: "P1, P2 ou P3 (P1 = priorité)" },
    statut: { type: "string", enum: ["a_contacter", "contacte", "a_repondu", "interesse", "paye", "pas_interesse"] },
    fiche_google: { type: "string", enum: ["oui", "non", "vide", "verifier", "none"], description: "none = non renseigné" },
    avec_telephone: { type: "boolean" }, limit: { type: "number" },
  }),
  fn("get_business", "Lit la fiche complète d'un commerce, son journal d'actions et l'historique de statuts.", { id: { type: "number" } }, ["id"]),
  fn("pipeline_stats", "Compteurs du pipeline par statut et chiffres de la semaine en cours.", {}),
  fn("followups_summary", "Résumé des actions des N derniers jours et des relances à faire.", { jours: { type: "number", description: "Défaut 7" } }),
  // --- écriture : ces outils ne font que PROPOSER ; l'utilisateur doit cliquer « Appliquer » ---
  fn("set_score", "Propose de changer le score de priorité (0-100) et la raison d'un commerce.", { id: { type: "number" }, score: { type: "number" }, raison: { type: "string" } }, ["id", "score"]),
  fn("set_label", "Propose de changer l'étiquette d'un commerce.", { id: { type: "number" }, etiquette: { type: "string" } }, ["id", "etiquette"]),
  fn("add_note", "Propose d'ajouter une note au journal d'un commerce.", { id: { type: "number" }, note: { type: "string" } }, ["id", "note"]),
];
export const WRITE_TOOLS = ["set_score", "set_label", "add_note"];

type Args = Record<string, unknown>;
export const parseArgs = (a: unknown): Args => { if (typeof a === "string") { try { return JSON.parse(a); } catch { return {}; } } return (a as Args) ?? {}; };

const compact = (b: ReturnType<typeof getBusiness>) => b && ({
  id: b.id, nom: b.nom, activite: b.activite, ville: b.ville, colonia: b.colonia, telephone: b.telephone || null,
  fiche_google: b.fiche_google || null, note_google: b.note_google, nb_avis: b.nb_avis, statut: statutLabel(b.statut),
  interet: b.interet || null, score: b.score, etiquette: b.etiquette || null, site_web: b.site_web || null,
  niche: b.niche || null, zone: b.zone || null, offre: b.offre || null, presence_web: b.presence_web || null, angle: b.angle || null,
});

export function runReadTool(name: string, a: Args): unknown {
  switch (name) {
    case "search_businesses": {
      let rows = listBusinesses({ q: a.q as string, ville: a.ville as string, activite: a.activite as string, statut: a.statut as string, fiche: a.fiche_google as string,
        niche: a.niche as string, zone: a.zone as string, offre: a.offre as string, sort: "score" }, 200);
      if (a.avec_telephone) rows = rows.filter((r) => r.tel_norm);
      const limit = Math.min(Number(a.limit) || 25, 50);
      return { total: rows.length, resultats: rows.slice(0, limit).map(compact) };
    }
    case "get_business": {
      const b = getBusiness(Number(a.id));
      if (!b) return { error: "Introuvable" };
      return { ...compact(b), notes: b.notes, email: b.email, adresse: b.adresse, score_raison: b.score_raison,
        prochaine_relance: b.next_followup, journal: businessActions(b.id).slice(0, 15), historique_statuts: businessHistory(b.id).slice(0, 10).map((h) => ({ statut: statutLabel(h.statut), date: h.at.slice(0, 10) })) };
    }
    case "pipeline_stats":
      return { par_statut: Object.fromEntries(Object.entries(pipelineCounts()).map(([k, v]) => [statutLabel(k), v])), semaine: weekStats() };
    case "followups_summary": {
      const jours = Number(a.jours) || 7;
      const since = addDays(today(), -jours);
      const actions = db.prepare("SELECT type, COUNT(*) n FROM actions WHERE day >= ? GROUP BY type").all(since);
      const dues = db.prepare("SELECT id, nom, next_followup FROM businesses WHERE statut='contacte' AND next_followup IS NOT NULL AND next_followup <= ? ORDER BY next_followup LIMIT 30").all(addDays(today(), 1));
      return { depuis: since, actions, relances_a_faire: dues };
    }
  }
  return { error: "Outil inconnu : " + name };
}

export type Proposal = { id: string; tool: string; args: Args; summary: string; status: "pending" | "applied" | "rejected" };

export function makeProposal(tool: string, a: Args): Proposal {
  const b = getBusiness(Number(a.id));
  const who = b ? `${b.nom} (#${b.id})` : `#${a.id} (introuvable)`;
  const summary =
    tool === "set_score" ? `Score de ${who} → ${a.score}${a.raison ? ` — ${a.raison}` : ""}` :
    tool === "set_label" ? `Étiquette de ${who} → « ${a.etiquette} »` :
    `Note sur ${who} : ${a.note}`;
  return { id: Math.random().toString(36).slice(2, 10), tool, args: a, summary, status: "pending" };
}

export function applyProposal(p: Proposal) {
  const id = Number(p.args.id);
  if (!getBusiness(id)) throw new Error("Commerce introuvable");
  if (p.tool === "set_score") {
    const score = Math.max(0, Math.min(100, Math.round(Number(p.args.score))));
    db.prepare("UPDATE businesses SET score=?, score_raison=? WHERE id=?").run(score, String(p.args.raison ?? ""), id);
  } else if (p.tool === "set_label") db.prepare("UPDATE businesses SET etiquette=? WHERE id=?").run(String(p.args.etiquette ?? ""), id);
  else if (p.tool === "add_note") logAction(id, "note", String(p.args.note ?? ""));
  else throw new Error("Outil inconnu");
}

/** Mode « contexte » : si le modèle gère mal les outils, on injecte les données utiles dans le prompt. */
export function contextBlock(): string {
  const rows = listBusinesses({ sort: "score" }, 80).map((b) =>
    `#${b.id} | ${b.nom} | ${b.activite} | ${b.ville} | ${statutLabel(b.statut)} | fiche:${b.fiche_google || "?"} | tel:${b.tel_norm ? "oui" : "non"} | intérêt:${b.interet || "?"} | score:${b.score ?? "-"}`);
  return `\n\nDonnées du CRM (extrait, 80 commerces max) :\nStats pipeline : ${JSON.stringify(runReadTool("pipeline_stats", {}))}\n${rows.join("\n")}`;
}
