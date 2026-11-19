import { DenueSettings, IaSettings } from "@/components/SettingsPanels";
import { saveTextSettings, revokeAllSessions } from "@/app/actions";
import ConfirmButton from "@/components/ConfirmButton";
import { getSetting, systemPrompt, criteria } from "@/lib/settings";
import { TEMPLATES } from "@/lib/whatsapp";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Reglages() {
  await requireSession("redirect");
  return (
    <>
      <h1>Réglages</h1>
      <h2>DENUE</h2><DenueSettings />
      <h2>IA</h2><IaSettings />
      <form action={saveTextSettings}>
        <h2>Messages WhatsApp</h2>
        <div className="card stack">
          <p className="small muted">Variable disponible : <code>{"{nom}"}</code> (nom du commerce). Un modèle vide ouvre WhatsApp sans texte.</p>
          {TEMPLATES.map((t) => (
            <label key={t.key} className="f">{t.label}
              <textarea name={t.setting} defaultValue={getSetting(t.setting)} placeholder="Écris ton message ici…" /></label>
          ))}
        </div>
        <h2>Classement IA &amp; prompt système</h2>
        <div className="card stack">
          <label className="f">Critères de priorité (utilisés par « Classer avec l'IA »)<textarea name="ia_criteria" defaultValue={criteria()} /></label>
          <label className="f">Prompt système du chat<textarea name="ia_system_prompt" defaultValue={systemPrompt()} style={{ minHeight: 140 }} /></label>
        </div>
        <div style={{ marginTop: 12 }}><button className="btn primary">Enregistrer les textes</button></div>
      </form>
      <h2>Sécurité</h2>
      <form action={revokeAllSessions} className="card stack">
        <p className="small muted">Déconnecte tous les appareils (y compris celui-ci). À utiliser si un appareil est perdu ou si tu soupçonnes un accès.</p>
        <div><ConfirmButton className="btn danger" message="Déconnecter toutes les sessions, y compris celle-ci ?">Déconnecter toutes les sessions</ConfirmButton></div>
      </form>
    </>
  );
}
