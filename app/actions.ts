"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { insertBusiness, updateBusiness, deleteBusiness, setStatus, logAction, getBusiness, bulkSetStatus, bulkSetOffre, idsForFilter } from "@/lib/crm";
import { readFilters } from "@/lib/filters";
import { setSetting, type SettingKey } from "@/lib/settings";
import { ACTION_TYPES, CHECKLIST, FORMULES, STAT_FIELDS, STATUTS } from "@/lib/constants";
import { COOKIE } from "@/lib/auth";
import { formatZod } from "@/lib/api";
import { bumpSessionVersion, loginUrl, requireSession } from "@/lib/session";

// Chaque action : requireSession("redirect") d'abord, puis validation zod.
// Une entrée invalide ne modifie rien et ne provoque jamais d'erreur 500 : l'action s'arrête et le motif est
// journalisé côté serveur (l'interface actuelle n'affiche pas d'erreur pour ces formulaires).

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => { const v = s(fd, k).replace(",", "."); return v === "" || isNaN(Number(v)) ? null : Number(v); };

function valid<T extends z.ZodType>(name: string, schema: T, data: unknown): z.infer<T> | null {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  console.warn(`[bedolt-crm] action ${name} refusée : ${formatZod(r.error)}`);
  return null;
}

const zId = z.number().int().positive().max(2 ** 31);
const txt = (max: number) => z.string().max(max);
const nullableNum = (min: number, max: number, int = false) => (int ? z.number().int() : z.number()).min(min).max(max).nullable();
const statutKeys = STATUTS.map((x) => x.key) as [string, ...string[]];

const BusinessSchema = z.object({
  nom: txt(300).min(1), activite: txt(300), telephone: txt(50), whatsapp: txt(50), email: txt(200), site_web: txt(500),
  adresse: txt(500), colonia: txt(200), ville: txt(200), lat: nullableNum(-90, 90), lng: nullableNum(-180, 180),
  fiche_google: z.enum(["", "oui", "non", "vide", "verifier"]), lien_google: txt(1000),
  note_google: nullableNum(0, 5), nb_avis: nullableNum(0, 10_000_000, true), notes: txt(20_000),
  interet: z.enum(["", "chaud", "tiede", "froid"]),
  niche: txt(200), zone: txt(200), offre: txt(20), presence_web: txt(200), angle: txt(2000), message_whatsapp: txt(5000),
});

function businessFromForm(fd: FormData) {
  return {
    nom: s(fd, "nom"), activite: s(fd, "activite"), telephone: s(fd, "telephone"), whatsapp: s(fd, "whatsapp"),
    email: s(fd, "email"), site_web: s(fd, "site_web"), adresse: s(fd, "adresse"), colonia: s(fd, "colonia"),
    ville: s(fd, "ville"), lat: num(fd, "lat"), lng: num(fd, "lng"), fiche_google: s(fd, "fiche_google"),
    lien_google: s(fd, "lien_google"), note_google: num(fd, "note_google"), nb_avis: num(fd, "nb_avis"),
    notes: s(fd, "notes"), interet: s(fd, "interet"),
    niche: s(fd, "niche"), zone: s(fd, "zone"), offre: s(fd, "offre"), presence_web: s(fd, "presence_web"),
    angle: s(fd, "angle"), message_whatsapp: String(fd.get("message_whatsapp") ?? "").trim(),
  };
}
const idOf = (fd: FormData) => Number(s(fd, "id"));

export async function saveBusiness(fd: FormData) {
  await requireSession("redirect");
  const id = Number(s(fd, "id")) || 0;
  if (!s(fd, "nom")) return;
  const data = valid("saveBusiness", BusinessSchema, businessFromForm(fd));
  if (!data) return;
  if (id) {
    if (!getBusiness(id)) return;
    updateBusiness(id, data); revalidatePath("/", "layout"); redirect(`/commerces/${id}`);
  }
  const newId = insertBusiness({ ...data, source: "manuel" });
  revalidatePath("/", "layout");
  redirect(`/commerces/${newId}`);
}

export async function removeBusiness(fd: FormData) {
  await requireSession("redirect");
  const id = valid("removeBusiness", zId, idOf(fd));
  if (!id) return;
  deleteBusiness(id);
  revalidatePath("/", "layout");
  redirect("/commerces");
}

export async function changeStatus(id: number, statut: string) {
  await requireSession("redirect");
  const v = valid("changeStatus", z.object({ id: zId, statut: z.enum(statutKeys) }), { id, statut });
  if (!v) return;
  setStatus(v.id, v.statut);
  revalidatePath("/", "layout");
}
export async function changeStatusForm(fd: FormData) {
  await requireSession("redirect");
  await changeStatus(idOf(fd), s(fd, "statut"));
}

// ---------- Actions groupées (liste des commerces) ----------
const BulkSchema = z.object({
  ids: z.array(zId).max(5000).optional(),
  query: z.string().max(4000).optional(),   // « toutes les fiches du filtre » : filtres de l'URL, relus côté serveur
  statut: z.enum(statutKeys).optional(),
  offre: txt(20).optional(),
  idsOnly: z.boolean().optional(),
}).refine((v) => !!v.ids !== (v.query !== undefined), "ids ou query (un seul)");

export async function bulkUpdate(input: z.input<typeof BulkSchema>): Promise<{ changed?: number; ids?: number[]; error?: string }> {
  await requireSession("redirect");
  const v = valid("bulkUpdate", BulkSchema, input);
  if (!v) return { error: "Entrée invalide." };
  const ids = v.ids ?? idsForFilter(readFilters(Object.fromEntries(new URLSearchParams(v.query))).f, 5000);
  if (v.idsOnly) return { ids };
  let changed = 0;
  if (v.statut) changed = bulkSetStatus(ids, v.statut);
  else if (v.offre !== undefined) changed = bulkSetOffre(ids, v.offre.trim());
  else return { error: "Aucune modification demandée." };
  revalidatePath("/", "layout");
  return { changed };
}

export async function addAction(fd: FormData) {
  await requireSession("redirect");
  const v = valid("addAction", z.object({ id: zId, type: z.enum(ACTION_TYPES.map((a) => a.key) as [string, ...string[]]), content: txt(5000) }),
    { id: idOf(fd), type: s(fd, "type"), content: s(fd, "content") });
  if (!v) return;
  logAction(v.id, v.type, v.content);
  revalidatePath("/", "layout");
}

export async function setEtiquette(fd: FormData) {
  await requireSession("redirect");
  const v = valid("setEtiquette", z.object({ id: zId, etiquette: txt(200), score: nullableNum(0, 100), score_raison: txt(1000) }),
    { id: idOf(fd), etiquette: s(fd, "etiquette"), score: num(fd, "score"), score_raison: s(fd, "score_raison") });
  if (!v) return;
  db.prepare("UPDATE businesses SET etiquette=?, score=?, score_raison=? WHERE id=?").run(v.etiquette, v.score, v.score_raison, v.id);
  revalidatePath("/", "layout");
}

// ---------- Clients ----------
const money = z.number().min(0).max(1e9);
const ClientSchema = z.object({
  id: zId, formule: z.enum(FORMULES), prix_install: money, prix_mensuel: money.nullable(), acompte_montant: money.nullable(),
  acompte_date: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]), parrain_id: zId.nullable(),
});

export async function saveClient(fd: FormData) {
  await requireSession("redirect");
  const v = valid("saveClient", ClientSchema, {
    id: idOf(fd), formule: s(fd, "formule") || "Base", prix_install: num(fd, "prix_install") ?? 0, prix_mensuel: num(fd, "prix_mensuel"),
    acompte_montant: num(fd, "acompte_montant"), acompte_date: s(fd, "acompte_date"), parrain_id: Number(s(fd, "parrain_id")) || null,
  });
  if (!v) return;
  const id = v.id;
  const checklist: Record<string, boolean> = {};
  for (const c of CHECKLIST) checklist[c.key] = fd.get(`chk_${c.key}`) === "on";
  const paid = fd.get("acompte_paye") === "on";
  const prev = db.prepare("SELECT acompte_paye, acompte_date FROM clients WHERE business_id=?").get(id) as { acompte_paye: number; acompte_date: string | null } | undefined;
  const date = v.acompte_date || (paid && !prev?.acompte_paye ? new Date().toISOString().slice(0, 10) : prev?.acompte_date ?? null);
  const install = v.prix_install;
  db.prepare(`UPDATE clients SET formule=?, prix_install=?, prix_mensuel=?, acompte_montant=?, acompte_paye=?, acompte_date=?, checklist=?, parrain_id=? WHERE business_id=?`)
    .run(v.formule, install, v.prix_mensuel ?? 0,
      v.acompte_montant ?? install / 2, paid ? 1 : 0, paid ? date : null,
      JSON.stringify(checklist), v.parrain_id && v.parrain_id !== id && getBusiness(v.parrain_id) ? v.parrain_id : null, id);
  revalidatePath("/", "layout");
}

export async function saveStats(fd: FormData) {
  await requireSession("redirect");
  const v = valid("saveStats", z.object({
    id: zId, month: z.string().regex(/^(base|\d{4}-(0[1-9]|1[0-2]))$/),
    vals: z.array(nullableNum(0, 1e9, true)).length(STAT_FIELDS.length),
  }), { id: idOf(fd), month: s(fd, "month"), vals: STAT_FIELDS.map((f) => num(fd, f.key)) });
  if (!v || !getBusiness(v.id)) return;
  db.prepare(`INSERT INTO client_stats(business_id, month, ${STAT_FIELDS.map((f) => f.key).join(",")}) VALUES(?,?,${v.vals.map(() => "?").join(",")})
    ON CONFLICT(business_id, month) DO UPDATE SET ${STAT_FIELDS.map((f) => `${f.key}=excluded.${f.key}`).join(",")}`).run(v.id, v.month, ...v.vals);
  revalidatePath("/", "layout");
}

// ---------- Réglages (textes uniquement ; token DENUE / IA : voir app/api/settings) ----------
export async function saveTextSettings(fd: FormData) {
  await requireSession("redirect");
  const keys = ["tpl_first", "tpl_j2", "tpl_j7", "ia_system_prompt", "ia_criteria"] as SettingKey[];
  const v = valid("saveTextSettings", z.record(z.string(), txt(10_000)),
    Object.fromEntries(keys.filter((k) => fd.has(k)).map((k) => [k, String(fd.get(k) ?? "")])));
  if (!v) return;
  for (const k of keys) if (k in v) setSetting(k, v[k]);
  revalidatePath("/reglages");
}

// ---------- Sécurité ----------
/** « Déconnecter toutes les sessions » : incrémente session_version → tous les cookies (y compris celui-ci) deviennent invalides. */
export async function revokeAllSessions() {
  await requireSession("redirect");
  bumpSessionVersion();
  (await cookies()).delete(COOKIE);
  redirect(loginUrl());
}
