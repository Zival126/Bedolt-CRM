// Fond de carte (raster), choisi par MAP_TILES dans .env. Compatible Edge (middleware : CSP) et Node.
//   osm   (défaut) : tuiles OpenStreetMap standard, gratuites et sans clé, assombries en CSS pour le thème sombre.
//                    Usage léger accepté par la politique OSM (un seul utilisateur) ; attribution obligatoire.
//   carto           : CARTO Dark Matter. Depuis 2026, CARTO renvoie une tuile « API KEY REQUIRED » sans clé :
//                    à n'utiliser qu'avec un accès CARTO valide.
export type TileConfig = { url: string; subdomains: string; attribution: string; darken: boolean; maxZoom: number; hosts: string[] };

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

export function tileConfig(): TileConfig {
  if ((process.env.MAP_TILES ?? "").trim().toLowerCase() === "carto") {
    return {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", subdomains: "abcd", darken: false, maxZoom: 20,
      attribution: OSM_ATTR + ' &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>',
      hosts: ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com`),
    };
  }
  return { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", subdomains: "", darken: true, maxZoom: 19, attribution: OSM_ATTR, hosts: ["https://tile.openstreetmap.org"] };
}
