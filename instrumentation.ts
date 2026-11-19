// Exécuté une fois au démarrage du serveur.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startupChecks } = await import("./lib/startup");
  startupChecks();
}
