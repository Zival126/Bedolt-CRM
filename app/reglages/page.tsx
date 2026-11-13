import { DenueSettings, IaSettings } from "@/components/SettingsPanels";
import { saveTextSettings } from "@/app/actions";
import { getSetting, systemPrompt, criteria } from "@/lib/settings";
import { TEMPLATES } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export default function Reglages() {
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
    </>
  );
}
