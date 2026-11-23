import { DenueSettings, IaSettings } from "@/components/SettingsPanels";
import NichesEditor from "@/components/NichesEditor";
import { saveTextSettings, revokeAllSessions } from "@/app/actions";
import ConfirmButton from "@/components/ConfirmButton";
import ActionForm from "@/components/ActionForm";
import ObjectivesForm from "@/components/ObjectivesForm";
import { getSetting, systemPrompt, criteria, objectives } from "@/lib/settings";
import { distinct } from "@/lib/crm";
import { matchingNew } from "@/lib/queue-count";
import { WA_RISK } from "@/lib/constants";
import { TEMPLATES } from "@/lib/whatsapp";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Reglages() {
  await requireSession("redirect");
  const o = objectives();
  return (
    <>
      <h1>Réglages</h1>
      <nav className="tabs settings-nav" aria-label="Sections">
        <a href="#objectifs">Objectifs</a><a href="#messages">Messages</a><a href="#ia">IA</a><a href="#denue">DENUE</a><a href="#securite">Sécurité</a>
      </nav>
      <h2 id="objectifs">Objectifs</h2>
      <ObjectivesForm initial={o} matching={matchingNew(o)} risk={WA_RISK}
        options={{ niches: distinct("niche"), zones: distinct("zone"), offres: distinct("offre"), villes: distinct("ville") }} />

      <ActionForm action={saveTextSettings} submit="Enregistrer les textes">
        <h2 id="messages">Messages WhatsApp</h2>
        <div className="card stack">
          <p className="small muted" style={{ margin: 0 }}>Variable disponible : <code>{"{nom}"}</code> (nom du commerce). Le premier message utilise d'abord le message personnalisé de la fiche. Un modèle vide ouvre WhatsApp sans texte.</p>
          {TEMPLATES.map((t) => (
            <label key={t.key} className="f">{t.label}
              <textarea name={t.setting} defaultValue={getSetting(t.setting)} placeholder="Écris ton message ici…" /></label>
          ))}
        </div>
        <h2 id="ia">Classement IA &amp; prompt système</h2>
        <div className="card stack">
          <label className="f">Critères de priorité (utilisés par « Classer avec l'IA »)<textarea name="ia_criteria" defaultValue={criteria()} /></label>
          <label className="f">Prompt système du chat<textarea name="ia_system_prompt" defaultValue={systemPrompt()} style={{ minHeight: 140 }} /></label>
        </div>
      </ActionForm>
      <h2>Connexion IA</h2><IaSettings />
      <h2 id="denue">DENUE</h2><DenueSettings />
      <div style={{ marginTop: 10 }}><NichesEditor /></div>
      <h2 id="securite">Sécurité</h2>
      <form action={revokeAllSessions} className="card stack">
        <p className="small muted" style={{ margin: 0 }}>Déconnecte tous les appareils (y compris celui-ci). À utiliser si un appareil est perdu ou si tu soupçonnes un accès.</p>
        <div><ConfirmButton className="btn danger" message="Déconnecter toutes les sessions, y compris celle-ci ?">Déconnecter toutes les sessions</ConfirmButton></div>
      </form>
    </>
  );
}
