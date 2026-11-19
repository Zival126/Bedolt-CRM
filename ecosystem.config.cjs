// Configuration PM2 : `pm2 start ecosystem.config.cjs` (lancé par scripts/deploy.sh sous l'utilisateur bedoltcrm).
// Écoute UNIQUEMENT sur 127.0.0.1 : seul le proxy OpenLiteSpeed local peut joindre l'application.
const fs = require("node:fs");
const path = require("node:path");

// On ne lit que PORT dans .env (les secrets ne doivent pas finir dans ~/.pm2/dump.pm2 ; Next lit .env lui-même).
let port = "3100";
try {
  const m = fs.readFileSync(path.join(__dirname, ".env"), "utf8").match(/^PORT=(\d+)\s*$/m);
  if (m) port = m[1];
} catch {}

module.exports = {
  apps: [{
    name: "bedolt-crm",
    cwd: __dirname,
    script: "node_modules/next/dist/bin/next",
    args: `start -H 127.0.0.1 -p ${port}`,
    interpreter: "node",
    env: { NODE_ENV: "production" },
    time: true,             // horodatage des logs PM2
    max_restarts: 10,       // en cas de .env invalide (démarrage refusé), PM2 n'insiste pas indéfiniment
    restart_delay: 3000,
    max_memory_restart: "600M",
  }],
};
