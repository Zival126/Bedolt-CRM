// Exécuté une fois au démarrage du serveur.
export async function register() {
  // Forme « if (NEXT_RUNTIME === "nodejs") { import() } » : Next retire ce bloc du bundle Edge (better-sqlite3 est natif).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startupChecks } = await import("./lib/startup");
    startupChecks();
    // Ouvre la base dès le démarrage : les migrations (lib/db.ts) s'appliquent avant la première requête.
    const { db, SCHEMA_VERSION } = await import("./lib/db");
    console.log(`[bedolt-crm] base prête (schéma v${db.pragma("user_version", { simple: true })}/${SCHEMA_VERSION})`);
    // État / municipio des fiches qui n'en ont pas encore (catalogue INEGI national)
    try { const { backfillZones } = await import("./lib/geo-backfill"); const n = backfillZones(); if (n) console.log(`[bedolt-crm] zones : ${n} fiche(s) complétée(s) (État / municipio)`); }
    catch (e) { console.warn("[bedolt-crm] zones : complément impossible", e); }
    // Géocodage en arrière-plan (file persistante : reprend après un redémarrage).
    const { startGeocoder } = await import("./lib/geocode");
    startGeocoder();
    // Veille DENUE : recherches enregistrées « relancer chaque semaine » (aucun ajout automatique au CRM).
    const { startDenueWatch } = await import("./lib/denue-watch");
    startDenueWatch();
    // Enrichissement des fiches depuis leur site web (file persistante, comme le géocodage).
    const { startEnricher } = await import("./lib/enrich");
    startEnricher();
    // Analyse de présence web (sans IA) : même file persistante (WEBAUDIT=off pour couper).
    const { startWebAuditor } = await import("./lib/web-audit");
    startWebAuditor();
  }
}
