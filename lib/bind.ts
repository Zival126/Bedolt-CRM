/**
 * Vrai si le serveur a été lancé avec `-H 127.0.0.1` (ou localhost / ::1) : toute connexion TCP vient alors
 * du proxy local. Module sans dépendance Node (importé aussi par instrumentation.ts).
 */
export function boundToLoopback(argv: string[] = process.argv): boolean {
  let host = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-H" || argv[i] === "--hostname") host = argv[i + 1] ?? "";
    else if (argv[i].startsWith("--hostname=")) host = argv[i].slice(11);
  }
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
