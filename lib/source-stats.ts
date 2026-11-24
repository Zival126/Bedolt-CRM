// Qualité et rendement par source (Stats) : une fiche multi-sources compte dans chacune de ses sources.
import { db } from "./db";
import { SOURCE_LABEL } from "./sources";

export type SourceStat = {
  key: string; label: string; total: number; tel: number; email: number; site: number; wa: number; social: number;
  contactes: number; repondu: number; interesse: number; clients: number; dnc: number;
};

export function sourceStats(): SourceStat[] {
  const rows = db.prepare(`
    WITH RECURSIVE split(id, rest, src) AS (
      SELECT id, sources || ',', '' FROM businesses
      UNION ALL SELECT id, substr(rest, instr(rest, ',') + 1), trim(substr(rest, 1, instr(rest, ',') - 1)) FROM split WHERE rest != ''
    )
    SELECT s.src key, COUNT(*) total,
      SUM(b.tel_norm != '') tel, SUM(b.email != '') email, SUM(b.site_web != '') site,
      SUM(b.no_whatsapp = 0 AND b.wa_confirme = 1) wa, SUM(b.facebook != '' OR b.instagram != '' OR b.tiktok != '') social,
      SUM(b.statut != 'a_contacter' OR b.first_contact_at IS NOT NULL) contactes,
      SUM(b.statut IN ('a_repondu','interesse','paye') OR EXISTS (SELECT 1 FROM actions a WHERE a.business_id = b.id AND a.type IN ('repondu','appel_repondu'))) repondu,
      SUM(b.statut IN ('interesse','paye') OR EXISTS (SELECT 1 FROM status_history h WHERE h.business_id = b.id AND h.statut = 'interesse')) interesse,
      SUM(b.statut = 'paye') clients, SUM(b.ne_pas_contacter = 1) dnc
    FROM split s JOIN businesses b ON b.id = s.id WHERE s.src != '' GROUP BY s.src ORDER BY total DESC`).all() as Omit<SourceStat, "label">[];
  return rows.map((r) => ({ ...r, label: SOURCE_LABEL[r.key] ?? r.key }));
}
