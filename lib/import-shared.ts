// Fonction partagée client/serveur (lib/import.ts importe exceljs, qu'on ne veut pas côté navigateur).
export const normHeader = (h: string) =>
  h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
