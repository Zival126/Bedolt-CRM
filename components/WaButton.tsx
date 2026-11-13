"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Un clic : le serveur vérifie la limite, journalise « WhatsApp envoyé », puis on ouvre wa.me.
export default function WaButton({ id, template, label = "WhatsApp", disabled, limitReached, small }: {
  id: number; template?: "first" | "j2" | "j7"; label?: string; disabled?: boolean; limitReached?: boolean; small?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function click() {
    if (limitReached) return alert("Limite du jour atteinte : 20 messages WhatsApp. Reprends demain.");
    setBusy(true);
    const r = await fetch("/api/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, template }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return alert(j.error);
    router.refresh();
    window.location.href = j.url;
  }
  return (
    <button type="button" className={`btn wa${small ? " sm" : ""}${limitReached ? " off" : ""}`} disabled={disabled || busy} onClick={click}>
      {label}
    </button>
  );
}
