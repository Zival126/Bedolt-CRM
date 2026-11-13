"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, now } from "@/lib/db";
import { insertBusiness, updateBusiness, deleteBusiness, setStatus, logAction, getBusiness } from "@/lib/crm";
import { setSetting, getSetting, type SettingKey } from "@/lib/settings";
import { CHECKLIST, STAT_FIELDS } from "@/lib/constants";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => { const v = s(fd, k).replace(",", "."); return v === "" || isNaN(Number(v)) ? null : Number(v); };

function businessFromForm(fd: FormData) {
  return {
    nom: s(fd, "nom"), activite: s(fd, "activite"), telephone: s(fd, "telephone"), whatsapp: s(fd, "whatsapp"),
    email: s(fd, "email"), site_web: s(fd, "site_web"), adresse: s(fd, "adresse"), colonia: s(fd, "colonia"),
    ville: s(fd, "ville"), lat: num(fd, "lat"), lng: num(fd, "lng"), fiche_google: s(fd, "fiche_google"),
    lien_google: s(fd, "lien_google"), note_google: num(fd, "note_google"), nb_avis: num(fd, "nb_avis"),
    notes: s(fd, "notes"), interet: s(fd, "interet"),
  };
}

export async function saveBusiness(fd: FormData) {
  const id = Number(s(fd, "id")) || 0;
  const data = businessFromForm(fd);
  if (!data.nom) return;
  if (id) { updateBusiness(id, data); revalidatePath("/", "layout"); redirect(`/commerces/${id}`); }
  const newId = insertBusiness({ ...data, source: "manuel" });
  revalidatePath("/", "layout");
  redirect(`/commerces/${newId}`);
}

export async function removeBusiness(fd: FormData) {
  deleteBusiness(Number(s(fd, "id")));
  revalidatePath("/", "layout");
  redirect("/commerces");
}

export async function changeStatus(id: number, statut: string) {
  setStatus(id, statut);
  revalidatePath("/", "layout");
}
export async function changeStatusForm(fd: FormData) { await changeStatus(Number(s(fd, "id")), s(fd, "statut")); }

export async function addAction(fd: FormData) {
  const id = Number(s(fd, "id"));
  logAction(id, s(fd, "type"), s(fd, "content"));
  revalidatePath("/", "layout");
}

export async function setEtiquette(fd: FormData) {
  db.prepare("UPDATE businesses SET etiquette=?, score=?, score_raison=? WHERE id=?")
    .run(s(fd, "etiquette"), num(fd, "score"), s(fd, "score_raison"), Number(s(fd, "id")));
  revalidatePath("/", "layout");
}

// ---------- Clients ----------
export async function saveClient(fd: FormData) {
  const id = Number(s(fd, "id"));
  const checklist: Record<string, boolean> = {};
  for (const c of CHECKLIST) checklist[c.key] = fd.get(`chk_${c.key}`) === "on";
  const paid = fd.get("acompte_paye") === "on";
  const prev = db.prepare("SELECT acompte_paye, acompte_date FROM clients WHERE business_id=?").get(id) as { acompte_paye: number; acompte_date: string | null } | undefined;
  const date = s(fd, "acompte_date") || (paid && !prev?.acompte_paye ? new Date().toISOString().slice(0, 10) : prev?.acompte_date ?? null);
  const install = num(fd, "prix_install") ?? 0;
  db.prepare(`UPDATE clients SET formule=?, prix_install=?, prix_mensuel=?, acompte_montant=?, acompte_paye=?, acompte_date=?, checklist=?, parrain_id=? WHERE business_id=?`)
    .run(s(fd, "formule") || "Base", install, num(fd, "prix_mensuel") ?? 0,
      num(fd, "acompte_montant") ?? install / 2, paid ? 1 : 0, paid ? date : null,
      JSON.stringify(checklist), Number(s(fd, "parrain_id")) || null, id);
  revalidatePath("/", "layout");
}

export async function saveStats(fd: FormData) {
  const id = Number(s(fd, "id"));
  const month = s(fd, "month");
  if (!/^(base|\d{4}-\d{2})$/.test(month)) return;
  const vals = STAT_FIELDS.map((f) => num(fd, f.key));
  db.prepare(`INSERT INTO client_stats(business_id, month, ${STAT_FIELDS.map((f) => f.key).join(",")}) VALUES(?,?,${vals.map(() => "?").join(",")})
    ON CONFLICT(business_id, month) DO UPDATE SET ${STAT_FIELDS.map((f) => `${f.key}=excluded.${f.key}`).join(",")}`).run(id, month, ...vals);
  revalidatePath("/", "layout");
}

// ---------- Réglages (textes uniquement ; token DENUE / IA : voir app/api/settings) ----------
export async function saveTextSettings(fd: FormData) {
  const keys = ["tpl_first", "tpl_j2", "tpl_j7", "ia_system_prompt", "ia_criteria"] as SettingKey[];
  for (const k of keys) if (fd.has(k)) setSetting(k, String(fd.get(k) ?? ""));
  revalidatePath("/reglages");
}
