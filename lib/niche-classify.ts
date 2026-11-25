// Classement déterministe (sans IA) d'un texte (libellé de niche, colonne « Niche » d'un fichier, titre SCIAN, catégorie
// Overture) vers une NICHE PRINCIPALE, par mots-clés français + espagnols. Sans accès à la base.
//
// Règles :
// - texte replié (minuscules, sans accents ni ponctuation), découpé en mots, mots vides retirés ;
// - un mot-clé court (≤ 3 lettres) doit être un mot entier ; sinon il suffit que le mot COMMENCE par le mot-clé
//   (« dent » → dentaire, dentista) ; une expression de plusieurs mots doit apparaître telle quelle ;
// - la niche du PREMIER mot significatif reconnu l'emporte (« Barbier & Grooming » → Barbiers) ; au même mot,
//   l'expression la plus longue gagne (« estética canina » → Vétérinaires, pas Beauté) ;
// - mots « faibles » (clinique, service, 24h…) : comptés seulement si aucun mot fort n'est reconnu ;
// - confiance 0-100 : 100 nom identique, ~90 une seule niche reconnue, moins quand plusieurs niches se disputent le texte.

export type MainNiche = { key: string; label: string; icon: string; desc: string; aliases?: string[]; words: string[]; weak?: string[]; strong?: string[] };

/**
 * Termes de recherche par défaut des API de lieux (Foursquare, HERE, Google : espagnol ; TomTom : nom de catégorie
 * anglais). Ajoutés aux correspondances de la niche principale de même nom ; modifiables dans la page Niches.
 */
export const API_TERMS: Record<string, { es: string[]; en: string[] }> = {
  beaute: { es: ["salón de belleza"], en: ["beauty salon"] }, barbiers: { es: ["barbería"], en: ["barber"] },
  ongles: { es: ["uñas"], en: ["nail salon"] }, spa: { es: ["spa"], en: ["spa"] }, dentistes: { es: ["dentista"], en: ["dentist"] },
  veto: { es: ["veterinaria"], en: ["veterinarian"] }, sport: { es: ["gimnasio"], en: ["gym"] }, sante: { es: ["fisioterapia"], en: ["physiotherapist"] },
  restaurants: { es: ["restaurante"], en: ["restaurant"] }, boulangeries: { es: ["panadería"], en: ["bakery"] },
  auto: { es: ["taller mecánico"], en: ["car repair"] }, location: { es: ["renta de autos"], en: ["car rental"] },
  depannage: { es: ["cerrajería", "plomería"], en: ["locksmith"] }, electronique: { es: ["reparación de celulares"], en: ["electronics"] },
  evenements: { es: ["salón de eventos"], en: ["banquet rooms"] }, tatouage: { es: ["tatuajes"], en: ["tattoo"] }, services: { es: ["lavandería"], en: ["laundry"] },
};

/** Niches principales proposées par défaut (modifiables avant d'appliquer un regroupement). */
export const MAIN_NICHES: MainNiche[] = [
  { key: "beaute", label: "Beauté & coiffure", icon: "scissors", desc: "Salons de beauté, coiffure, esthétique, cils et sourcils",
    aliases: ["beaute", "salon de beaute", "coiffure", "esthetique", "belleza", "estetica", "salon de belleza"],
    weak: ["corte", "color", "look"],
    words: ["beaut", "coiff", "belleza", "estetic", "esthetic", "peluquer", "cheveu", "cabello", "pelo", "maquill", "makeup", "extension", "lissage", "alisado", "keratin",
      "coloration", "tinte", "mechas", "balayage", "cils", "pestan", "lash", "sourcil", "ceja", "brow", "epilat", "epilac", "depila", "microblad", "brushing", "peinado",
      "salon de belleza", "salon de beaute", "facial", "soin du visage", "corte color", "skin care", "cosmet", "hair", "lifting", "permanente", "rizado", "bronzage", "bronceado", "spray tan"] },
  { key: "barbiers", label: "Barbiers", icon: "barber", desc: "Barbiers, barber shops", aliases: ["barbier", "barberia", "barber shop", "barbershop"],
    words: ["barb", "afeitado", "rasage", "fade", "degrade", "grooming homme", "corte de caballero", "coupe homme"] },
  { key: "ongles", label: "Ongles & manucure", icon: "sparkles", desc: "Ongles, manucure, pédicure, nail bars", aliases: ["ongles", "manucure", "unas", "nails", "nail bar"],
    words: ["ongle", "manucur", "manicur", "pedicur", "nail", "unas", "acrili", "acryl", "gelish", "semi permanent", "vernis", "esmaltad", "nail art"] },
  { key: "spa", label: "Spa & massages", icon: "flower", desc: "Spas, massages, relaxation", aliases: ["spa", "massages", "spa et massages"],
    words: ["spa", "spas", "massag", "masaj", "masseu", "masajista", "relax", "hammam", "sauna", "temazcal", "reflexolog", "aromather", "aromater", "drenaje linfatico", "drainage lymphatique",
      "piedras calientes", "pierres chaudes", "jacuzzi", "day spa", "holistic", "holistiq"] },
  { key: "dentistes", label: "Dentistes", icon: "tooth", desc: "Cabinets dentaires, orthodontie, implants", aliases: ["dentiste", "dentistes", "dentista", "dentistas", "clinique dentaire", "clinica dental"],
    words: ["dent", "odonto", "orthodon", "ortodon", "implant", "endodon", "parodon", "periodon", "carie", "bracket", "blanchiment dentaire", "blanqueamiento", "sonrisa",
      "sourire", "protesis dental", "prothese dentaire", "muela", "molaire", "invisalign", "alineador", "aligneur", "maxilo", "maxillo", "carilla", "facette", "estetica dental", "esthetique dentaire"] },
  { key: "veto", label: "Vétérinaires & animaux", icon: "paw", desc: "Cliniques vétérinaires, toilettage, pensions", aliases: ["veterinaire", "veterinaires", "veterinaria", "veterinario", "animaux", "mascotas"],
    strong: ["veterin", "canin", "felin", "mascot", "perro", "perros", "gato", "gatos", "chien", "chiens", "animal", "animaux", "pet", "pets"],
    words: ["veterin", "canin", "felin", "chien", "perro", "gato", "chat", "chats", "mascot", "animal", "animaux", "toilett", "pension canine", "pension pour animaux",
      "guarderia canina", "hotel canino", "hotel para mascotas", "adiestr", "dressage", "educateur canin", "estetica canina", "peluqueria canina", "grooming canin",
      "pet", "pets", "zootec", "acuario", "aquario"] },
  { key: "sport", label: "Salles de sport & studios", icon: "dumbbell", desc: "Fitness, CrossFit, Pilates, danse, arts martiaux",
    aliases: ["salle de sport", "salles de sport", "gym", "gimnasio", "fitness"],
    words: ["gym", "gyms", "gimnas", "fitness", "crossfit", "pilates", "yoga", "danse", "danza", "baile", "box", "boxe", "boxeo", "boxing", "martial", "marcial", "karate",
      "jiu", "judo", "taekwon", "muay", "kickbox", "mma", "martiaux", "arts martiaux", "artes marciales", "capoeira", "aikido", "zumba", "spinning", "cycling", "entrainement", "entrenamiento", "musculac", "musculat", "sport", "deport",
      "coach", "calisten", "natation", "natacion", "swim", "escalade", "escalada", "barre", "funcional", "fonctionnel", "hiit", "bootcamp", "salle de sport", "dance", "studio de danse"] },
  { key: "sante", label: "Santé & bien-être", icon: "health", desc: "Physio, optique, podologie, nutrition, psychologie", aliases: ["sante", "sante et bien etre", "salud", "bien etre", "bienestar"],
    words: ["physio", "fisio", "kine", "osteo", "chiropr", "quiropr", "optiq", "optic", "optom", "lunett", "lente", "podolo", "podiat", "nutri", "psych", "psic", "acupunct",
      "acupunt", "laborat", "pharmac", "farmac", "bien etre", "bienestar", "rehab", "reeduc", "medecin", "medic", "enfermer", "infirm", "audit", "audio", "ortoped", "orthoped",
      "sante", "salud", "dermat", "ginec", "gyneco", "pediat", "cardio", "terapia", "therapie", "massage therapeutique", "fertilid", "radiolog", "ultrason", "ecograf", "vacun", "physical therap", "doctor", "health"],
    weak: ["clinique", "clinica", "consultorio", "cabinet"] },
  { key: "restaurants", label: "Restaurants & cafés", icon: "utensils", desc: "Restaurants, cafés, bars, food", aliases: ["restaurant", "restaurants", "restaurante", "cafe", "cafes", "bar", "bars"],
    words: ["restaur", "cafe", "coffee", "taqu", "taco", "pizz", "burger", "hamburg", "comida", "cuisine", "cocina", "food", "sushi", "marisc", "bar", "bars", "cantin",
      "cerveza", "brew", "cocktail", "coctel", "mezcal", "heladeria", "helado", "glacier", "jugo", "juice", "smoothie", "crepe", "brunch", "desayun", "antojit", "pollo",
      "asador", "grill", "parrill", "bistro", "vegan", "poke", "ramen", "wings", "alitas", "birria", "pozole", "torta", "tortas", "hot dog", "snack", "fonda", "cenaduria",
      "lonche", "chef", "gastro", "pub", "lounge", "rooftop", "vinos", "wine", "comedor", "barbacoa", "ice cream", "fast food", "dining", "eatery"] },
  { key: "boulangeries", label: "Boulangeries & pâtisseries", icon: "store", desc: "Boulangeries, pâtisseries, gâteaux", aliases: ["boulangerie", "patisserie", "panaderia", "pasteleria"],
    words: ["boulang", "patiss", "panader", "pasteler", "reposter", "gateau", "pastel", "pasteles", "cupcake", "bakery", "viennois", "pan", "postre", "dessert", "dulcer",
      "chocolat", "galleta", "cookie", "donut", "dona", "donas", "macaron", "tarta", "tarte", "brioche", "croissant"] },
  { key: "auto", label: "Mécanique & auto", icon: "car", desc: "Freins, suspension, embrayage, carrosserie, pneus, électricité auto, lavage, motos",
    aliases: ["mecanique", "mecanica", "garage", "taller mecanico", "auto", "automotriz"],
    words: ["mecan", "frein", "freno", "suspens", "embray", "clutch", "amortis", "amortigu", "alignement", "alineac", "balanceo", "geometr", "carross", "hojalat",
      "debollage", "pintura automotriz", "peinture auto", "pneu", "llanta", "neumat", "moto", "motos", "voiture", "coche", "carro", "taller mecanico", "vidange",
      "cambio de aceite", "electricite auto", "electrique auto", "electrico automotriz", "autoelectric", "electrica automotriz", "lavage auto", "lavado de autos",
      "autolavado", "car wash", "carwash", "detailing", "pulido", "encerado", "radiateur", "radiador", "transmis", "diesel", "rotule", "rotula", "batterie", "bateria",
      "mofle", "silenci", "escape", "vulcaniz", "afinac", "garage", "scooter", "cuatrimoto", "automotr", "automobil", "auto", "autos", "refaccion", "piece auto",
      "polarizado", "teintage", "faros", "phares", "direction assistee", "inyeccion", "injection", "tapiceria automotriz", "estetica automotriz", "tire", "tires", "car repair", "body shop", "oil change", "motorcycle"],
    weak: ["diagnost", "servicio automotriz"] },
  { key: "location", label: "Location de véhicules", icon: "car", desc: "Location de voitures, motos, scooters, vélos",
    aliases: ["location de vehicules", "location de voitures", "renta de autos", "rent a car", "car rental"],
    words: ["location de voiture", "location de voitures", "location de vehicule", "location de vehicules", "location voiture", "location auto", "location de moto",
      "location de motos", "location scooter", "location de scooter", "location velo", "location de velo", "renta de autos", "renta de carros", "renta de coches",
      "renta de motos", "renta de bicicletas", "renta de vehiculos", "renta de camionetas", "renta de scooter", "alquiler de autos", "alquiler de coches",
      "alquiler de motos", "rent a car", "car rental", "rentadora", "arrendadora"] },
  { key: "depannage", label: "Dépannage & maison", icon: "home", desc: "Serrurerie, plomberie, électricité, climatisation, menuiserie, vitrerie, fumigation, piscines",
    aliases: ["depannage", "depannage et maison", "maison", "hogar", "mantenimiento"],
    words: ["serrur", "cerraj", "plomb", "plome", "fontan", "climatis", "climatiz", "clima", "aire acondicionado", "minisplit", "menuis", "carpint", "ebenist", "vitr",
      "vidri", "cristaler", "aluminio", "fumig", "plagas", "nuisib", "insect", "termit", "piscin", "alberc", "electricien", "electricista", "electricite", "electricidad",
      "depann", "handyman", "jardin", "paysag", "peintre", "pintor", "impermeab", "etanch", "toiture", "maconn", "albanil", "carrel", "azulej", "limpie", "nettoy",
      "desazolv", "debouch", "chauffe eau", "calentador", "gas", "herrer", "soldad", "portail", "demenag", "mudanz", "persian", "cortina", "store banne",
      "fosse septique", "fosa septica", "pintura", "peinture", "pintura residencial", "bomba de agua", "pompe", "tinaco", "cisterna", "construc", "remodel", "renovac", "renovat", "domotiq", "porton", "cerca electrica",
      "panneau solaire", "paneles solares", "solar", "techos", "tablaroca", "placo", "locksmith", "plumber", "plumbing", "electrician", "hvac", "pest control", "pool", "landscap", "cleaning", "roofing", "handyman", "glass"],
    weak: ["mantenimiento", "maintenance", "reparation", "reparacion", "hogar", "maison", "casa"] },
  { key: "electronique", label: "Réparation électronique & informatique", icon: "wrench", desc: "Téléphones, ordinateurs, électroménager",
    aliases: ["reparation electronique", "informatique", "electronica", "reparacion de celulares"],
    words: ["electroniq", "electronic", "electronica", "informat", "comput", "ordinat", "laptop", "celular", "telephone", "telefon", "movil", "smartphone", "iphone", "ipad",
      "tablet", "pc", "pantalla", "ecran", "consola", "videojuego", "jeux video", "impresora", "imprimante", "cctv", "camaras de seguridad", "videovigilancia",
      "software", "tecnolog", "electrodomest", "electromenag", "linea blanca", "refrigerac", "lavadora", "television", "tv", "redes", "fibra optica", "internet", "web",
      "soporte tecnico", "support informatique", "datos", "gadget", "accesorios para celular", "mobile phone", "phone repair", "appliance"] },
  { key: "evenements", label: "Événements & mariage", icon: "heart", desc: "Traiteurs, salles, fleuristes, photographes, DJ",
    aliases: ["evenements", "mariage", "evenementiel", "mariage et evenementiel", "eventos", "bodas"],
    words: ["mariag", "boda", "evenement", "evento", "event", "traiteur", "banquet", "catering", "salle de reception", "salon de eventos", "salle des fetes", "jardin de eventos",
      "fleur", "florist", "flor", "flores", "photograph", "fotograf", "dj", "mariachi", "wedding", "quinceaner", "xv anos", "fiesta", "party", "inflable", "mobiliario",
      "planner", "decorac", "decoration", "globos", "ballons", "musique live", "grupo musical", "pastel de boda", "pastel de bodas", "gateau de mariage", "mesa de dulces",
      "candy bar", "animac", "animat", "carpas", "toldos", "sonido", "iluminac", "video", "cater", "event planner", "venue"] },
  { key: "tatouage", label: "Tatouage & piercing", icon: "palette", desc: "Tatouage, piercing", aliases: ["tatouage", "tatuajes", "tattoo", "piercing"],
    words: ["tatou", "tatuaj", "tattoo", "piercing", "perfora", "ink", "microbladi tatuaje", "body art", "detatouage", "remocion de tatuajes"] },
  { key: "services", label: "Commerces & services", icon: "store", desc: "Blanchisserie, imprimerie, couture, auto-école, divers",
    aliases: ["commerces", "services", "commerces et services", "comercios", "servicios", "divers"],
    words: ["blanchis", "lavander", "laverie", "pressing", "tintorer", "nettoyage a sec", "imprim", "impren", "serigraf", "rotulo", "rotulac", "lona", "couture", "costur",
      "sastr", "retouche", "arreglo de ropa", "auto ecole", "autoescuela", "escuela de manejo", "ecole de conduite", "papeler", "copias", "fotocop", "regalo", "cadeau",
      "abarrot", "epicer", "minisuper", "mini super", "quincaill", "ferreter", "inmobil", "immobil", "notar", "abogad", "avocat", "comptab", "contad", "seguro", "assuran",
      "agencia de viajes", "voyage", "viaje", "tour", "tours", "hotel", "hostal", "posada", "idioma", "langue", "tutor", "guarderia",
      "creche", "garderie", "boutique", "tienda", "vetement", "ropa", "zapat", "chaussur", "joyer", "bijout", "reloj", "optique boutique", "libreria", "librairie",
      "muebl", "meuble", "colchon", "matelas", "laundry", "dry cleaning", "printing", "real estate", "insurance", "driving school", "travel agen"],
    weak: ["service", "servicio", "servicios", "commerce", "comercio", "negocio", "shop", "store", "agence", "agencia", "escuela", "ecole", "cours", "clases", "academia", "academie"] },
];

const STOP = new Set(["de", "la", "le", "les", "des", "du", "d", "l", "et", "y", "e", "en", "el", "los", "las", "un", "une", "una", "uno", "a", "au", "aux", "pour", "para",
  "con", "sans", "sin", "avec", "por", "par", "the", "and", "of", "for", "sur", "al", "o", "ou", "tout", "todo", "toda", "todos", "tous", "tres", "muy", "plus"]);

/** minuscules, sans accents ni ponctuation (identique à lib/scian.ts). */
export const foldText = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();
export const tokens = (s: string) => foldText(s).split(" ").filter((t) => t && !STOP.has(t));

type Kw = { niche: number; words: string[]; tier: number; len: number };
type Compiled = { list: MainNiche[]; kws: Kw[]; aliases: Map<string, number> };

/** Prépare les mots-clés d'une liste de niches principales (une fois par liste). */
export function compile(list: MainNiche[] = MAIN_NICHES): Compiled {
  const kws: Kw[] = [];
  const aliases = new Map<string, number>();
  list.forEach((n, i) => {
    for (const a of [n.label, ...(n.aliases ?? [])]) { const k = tokens(a).join(" "); if (k && !aliases.has(k)) aliases.set(k, i); }
    // tier : 0 faible (compté seulement s'il n'y a rien d'autre), 1 normal, 2 décisif (prime sur un mot normal plus tôt)
    for (const [arr, tier] of [[n.words, 1], [n.weak ?? [], 0], [n.strong ?? [], 2]] as const)
      for (const w of arr) { const words = tokens(w); if (words.length) kws.push({ niche: i, words, tier, len: words.join(" ").length }); }
  });
  return { list, kws, aliases };
}
const DEFAULT = compile();

const tokMatch = (kw: string, tok: string) => (kw.length <= 3 ? tok === kw : tok.startsWith(kw));

export type Classified = { index: number | null; key: string | null; confidence: number; reason: string };

/** Niche principale d'un texte. */
export function classifyText(text: string, c: Compiled = DEFAULT): Classified {
  const raw = foldText(text).split(" ").filter(Boolean);
  const toks = raw.filter((t) => !STOP.has(t));
  if (!toks.length) return { index: null, key: null, confidence: 0, reason: "texte vide" };
  const alias = c.aliases.get(toks.join(" "));
  if (alias !== undefined) return { index: alias, key: c.list[alias].key, confidence: 100, reason: "nom identique" };
  // Correspondances : niche, position du 1er mot, longueur, faible ?
  type M = { niche: number; pos: number; len: number; tier: number; kw: string };
  const ms: M[] = [];
  for (const k of c.kws) {
    for (let i = 0; i < toks.length; i++) {
      if (k.words.length === 1 ? tokMatch(k.words[0], toks[i]) : k.words.every((w, j) => toks[i + j] !== undefined && (j < k.words.length - 1 ? toks[i + j] === w : tokMatch(w, toks[i + j]))))
        { ms.push({ niche: k.niche, pos: i, len: k.len, tier: k.tier, kw: k.words.join(" ") }); break; }
    }
  }
  const strong = ms.filter((m) => m.tier > 0);
  const pool = strong.length ? strong : ms;
  if (!pool.length) return { index: null, key: null, confidence: 0, reason: "aucun mot-clé reconnu" };
  // Mot décisif d'abord, puis premier mot reconnu ; au même mot, l'expression la plus longue
  const top = Math.max(...pool.map((m) => m.tier));
  pool.sort((a, b) => Number(b.tier === top) - Number(a.tier === top) || a.pos - b.pos || b.len - a.len);
  const win = pool[0];
  // Un mot couvert par une expression plus longue d'une autre niche ne compte pas (ex. « estética » dans « estética canina »)
  const covered = (m: M) => pool.some((o) => o !== m && o.niche !== m.niche && o.pos <= m.pos && o.pos + o.kw.split(" ").length > m.pos && o.len > m.len);
  const score = new Map<number, number>();
  for (const m of pool) if (!covered(m)) score.set(m.niche, (score.get(m.niche) ?? 0) + 1);
  const ws = score.get(win.niche) ?? 1;
  const others = [...score].filter(([n]) => n !== win.niche);
  const best = Math.max(0, ...others.map(([, s]) => s));
  let conf = !others.length ? 90 : ws > best ? 78 : ws === best ? 62 : 52;
  if (!strong.length) conf = Math.min(conf, 45);    // seulement des mots faibles : toujours « incertain »
  if (win.pos > 0 && others.length) conf -= 5;
  return { index: win.niche, key: c.list[win.niche].key, confidence: Math.max(5, conf), reason: `« ${win.kw} »${others.length ? ` (aussi : ${others.map(([n]) => c.list[n].label).join(", ")})` : ""}` };
}

/** Seuil sous lequel un classement est montré comme « incertain ». */
export const SURE = 70;
