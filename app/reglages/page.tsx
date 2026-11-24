import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { DenueSettings, IaSettings } from "@/components/SettingsPanels";
import FavorisEditor from "@/components/FavorisEditor";
import { MessagesForm, IaTexts, OsmInstances, DisplaySettings } from "@/components/SettingsExtra";
import { entidades } from "@/lib/geo-mx";
import EnrichCard from "@/components/sources/EnrichCard";
import { googleEnabled, googleUsage } from "@/lib/google";
import { revokeAllSessions } from "@/app/actions";
import ConfirmButton from "@/components/ConfirmButton";
import ObjectivesForm from "@/components/ObjectivesForm";
import { PageHead, Section, NicheBadge, fmtN } from "@/components/ui";
import { getSetting, systemPrompt, criteria, objectives, mapColorMode } from "@/lib/settings";
import { distinct, sourceKeys } from "@/lib/crm";
import { nicheList } from "@/lib/niches";
import { matchingNew } from "@/lib/queue-count";
import { overtureMeta, overtureCount } from "@/lib/overture";
import { commerceColumns } from "@/lib/views";
import { COLUMNS } from "@/lib/columns";
import { WA_RISK } from "@/lib/constants";
import { TEMPLATES } from "@/lib/whatsapp";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Réglages · Bedolt CRM" };

const NAV = [["prospection", "Ma prospection"], ["messages", "Messages"], ["niches", "Niches"], ["zones", "Zones favorites"], ["sources", "Sources & clés"],
  ["ia", "IA"], ["affichage", "Affichage"], ["securite", "Sécurité & données"]] as const;

/** Dernière sauvegarde de la base (dossier backups/ : nom et date seulement). */
function lastBackup(): { name: string; at: Date; count: number } | null {
  try {
    const dir = path.resolve("backups");
    const files = fs.readdirSync(dir).filter((f) => /^crm-.*\.db$/.test(f)).map((f) => ({ name: f, at: fs.statSync(path.join(dir, f)).mtime }));
    if (!files.length) return null;
    files.sort((a, b) => +b.at - +a.at);
    return { ...files[0], count: files.length };
  } catch { return null; }
}

export default async function Reglages() {
  await requireSession("redirect");
  const o = objectives();
  const niches = nicheList(false);
  const bk = lastBackup();
  const om = overtureMeta(), oc = overtureCount();
  const hint: Record<string, string> = { first: "envoyé au premier contact (le message préparé de la fiche passe avant)", j2: "2 jours après sans réponse", j7: "7 jours après sans réponse" };
  return (
    <>
      <PageHead title="Réglages" lead="Règle ta prospection, tes messages, tes sources et l'IA. Chaque section s'enregistre séparément." />
      <div className="settings">
        <nav className="settings-side" aria-label="Sections des réglages">{NAV.map(([id, l]) => <a key={id} href={"#" + id}>{l}</a>)}</nav>
        <div style={{ minWidth: 0 }}>
          <Section id="prospection" title="1. Ma prospection" lead="Combien de prospects contacter par jour et lesquels en priorité."
            help={<><p>La <b>limite dure</b> est appliquée par le serveur : au-delà, un premier WhatsApp est refusé pour la journée (protège ton numéro du blocage).</p>
              <p>Le <b>filtre par défaut</b> choisit les « nouveaux à contacter » chaque jour. Sur la page Aujourd'hui, « Ma journée » peut le remplacer pour un jour seulement.</p></>}>
            <ObjectivesForm initial={o} matching={matchingNew(o)} risk={WA_RISK}
              options={{ niches, zones: distinct("zone"), offres: distinct("offre"), villes: distinct("ville"), sources: sourceKeys() }} />
          </Section>

          <Section id="messages" title="2. Messages" lead="Les textes WhatsApp pré-remplis. {nom} est remplacé par le nom du commerce."
            help={<p>Le premier message utilise d'abord le « Message WhatsApp » préparé dans la fiche (import Excel / Gemini). Un modèle vide ouvre WhatsApp sans texte. Rien n'est envoyé automatiquement : WhatsApp s'ouvre, tu envoies toi-même.</p>}>
            <MessagesForm initial={TEMPLATES.map((t) => ({ ...t, value: getSetting(t.setting), hint: hint[t.key] }))} />
          </Section>

          <Section id="niches" title="3. Niches" lead="Les types de commerces que tu prospectes, avec leur couleur et ce qui permet de les reconnaître.">
            <div className="card stack">
              <div className="row" style={{ gap: 6 }}>{niches.slice(0, 12).map((n) => <NicheBadge key={n.id} n={n} small />)}{niches.length > 12 && <span className="small muted">+{niches.length - 12}</span>}</div>
              <div><Link className="btn" href="/niches">Gérer les niches →</Link></div>
            </div>
          </Section>

          <Section id="zones" title="4. Zones favorites" lead="Raccourcis en un clic au-dessus du choix de zone (DENUE, prompt Gemini).">
            <FavorisEditor entidades={entidades().map((e) => ({ code: e.c, nom: e.n }))} />
          </Section>

          <Section id="sources" title="5. Sources & clés" lead="Connexions aux sources de prospects. Les clés restent sur le serveur, jamais dans le navigateur.">
            <div className="stack">
              <b className="small">DENUE (INEGI)</b>
              <DenueSettings />
              <b className="small">Google Places (facultatif)</b>
              <div className="card stack" style={{ gap: 4 }}>
                {googleEnabled()
                  ? <span className="small"><span className="state ok">Activé</span> · <b>{fmtN(googleUsage())}</b> requête(s) ce mois-ci (bouton « Vérifier sur Google » des fiches, 1 requête par clic).</span>
                  : <span className="small"><span className="state off">Désactivé</span> Aucune requête n'est faite. Pour l'activer : ajoute <code>GOOGLE_PLACES_KEY=…</code> dans <code>.env</code> sur le serveur, puis redémarre.</span>}
              </div>
              <b className="small">OpenStreetMap</b>
              <OsmInstances />
              <b className="small">Overture</b>
              <div className="card small">
                {oc ? <><span className="state ok">Données chargées</span> {fmtN(oc)} lieux (Quintana Roo) · version {om.release ?? "?"} · dernière synchro le {om.loaded_at ? new Date(om.loaded_at).toLocaleDateString("fr-FR") : "?"}. Mise à jour automatique chaque mois.</>
                  : <><span className="state warn">À configurer</span> Aucune donnée : lance la première synchronisation sur le serveur (voir <Link href="/sources/overture">Sources › Overture</Link>).</>}
              </div>
              <b className="small">Enrichissement automatique</b>
              <EnrichCard />
            </div>
          </Section>

          <Section id="ia" title="6. IA" lead="L'assistant du chat et le classement des prospects. Il tourne sur ton serveur (Ollama) ou via n8n."
            help={<p>« Tester la connexion » vérifie que le serveur IA répond et liste ses modèles. « Fonctions » laisse l'IA lire le CRM à la demande ; « Contexte injecté » envoie les données utiles dans le message (pour les modèles qui gèrent mal les outils).</p>}>
            <IaSettings />
            <IaTexts criteria={criteria()} system={systemPrompt()} />
          </Section>

          <Section id="affichage" title="7. Affichage" lead="Ce que tu vois par défaut dans les listes et sur la carte.">
            <DisplaySettings columns={commerceColumns()} mapColor={mapColorMode()} />
          </Section>

          <Section id="securite" title="8. Sécurité & données" lead="Sessions, export de toutes tes fiches et état des sauvegardes.">
            <div className="card stack">
              <b>Exporter toutes les fiches</b>
              <p className="small muted" style={{ margin: 0 }}>Un fichier CSV (UTF-8, séparateur « ; » pour Excel en français) avec toutes les colonnes.</p>
              <div><a className="btn" href={`/api/commerces/export?vue=toutes&sep=%3B&cols=${COLUMNS.map((c) => c.key).join(",")}`} download>Télécharger le CSV complet</a></div>
            </div>
            <div className="card stack">
              <b>Sauvegardes</b>
              {bk ? <span className="small"><span className={"state " + (Date.now() - +bk.at < 36 * 3600_000 ? "ok" : "warn")}>{Date.now() - +bk.at < 36 * 3600_000 ? "À jour" : "En retard"}</span> Dernière : {bk.at.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} · {bk.count} copie(s) sur le serveur.</span>
                : <span className="small"><span className="state warn">Aucune</span> Aucune sauvegarde trouvée dans <code>backups/</code> (le cron quotidien de 3 h 30 la crée).</span>}
            </div>
            <form action={revokeAllSessions} className="card stack">
              <b>Déconnecter tous les appareils</b>
              <p className="small muted" style={{ margin: 0 }}>Y compris celui-ci. À utiliser si un appareil est perdu ou si tu soupçonnes un accès.</p>
              <div><ConfirmButton className="btn danger" message="Déconnecter toutes les sessions, y compris celle-ci ?">Déconnecter toutes les sessions</ConfirmButton></div>
            </form>
          </Section>
        </div>
      </div>
    </>
  );
}
