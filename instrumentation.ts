// Exécuté une fois au démarrage du serveur.
export async function register() {
  // Forme « if (NEXT_RUNTIME === "nodejs") { import() } » : Next retire ce bloc du bundle Edge (better-sqlite3 est natif).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startupChecks } = await import("./lib/startup");
    startupChecks();
    // Ouvre la base dès le démarrage : les migrations (lib/db.ts) s'appliquent avant la première requête.
    const { db, SCHEMA_VERSION } = await import("./lib/db");
    console.log(`[bedolt-crm] base prête (schéma v${db.pragma("user_version", { simple: true })}/${SCHEMA_VERSION})`);
    // Géocodage en arrière-plan (file persistante : reprend après un redémarrage).
    const { startGeocoder } = await import("./lib/geocode");
    startGeocoder();
  }
}
