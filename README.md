# Bedolt CRM

CRM interne (un seul utilisateur) pour Bedolt : prospection de commerces locaux (Riviera Maya), pipeline, relances,
WhatsApp en 1 clic, suivi clients, IA locale (Ollama / n8n). Interface en français, mobile d'abord, thème sombre.

**Stack** : Next.js 15 (App Router, TypeScript) · SQLite via `better-sqlite3` (SQL direct, sans ORM : une seule
dépendance, schéma créé automatiquement dans `lib/db.ts`) · `exceljs` pour l'import/export `.xlsx`. Rien d'autre.

## Lancer en local

```bash
npm install
cp .env.example .env        # puis edite CRM_PASSWORD (et DENUE_TOKEN si tu l'as)
npm run dev                 # http://localhost:3000
```

Variables (`.env`) : `CRM_PASSWORD` (obligatoire), `SESSION_SECRET` (conseillé en prod), `DENUE_TOKEN` (valeur par
défaut, modifiable dans Réglages > DENUE), `DATABASE_PATH` (défaut `./data/crm.db`), `PORT` (défaut 3100),
`COOKIE_SECURE=false` seulement pour tester `npm start` en HTTP.

## Déployer sur le VPS (crm.bedolt.com)

Ne touche pas à bedolt.com : le CRM est une application Node à part, sur son propre sous-domaine.

1. **DNS** : enregistrement `A` `crm` → IP du VPS.
2. **Code** (Node 20+ requis ; compilation native de better-sqlite3 : `build-essential`/`python3` si pas de binaire précompilé) :
   ```bash
   git clone https://github.com/Zival126/Bedolt-CRM.git /var/www/bedolt-crm && cd /var/www/bedolt-crm
   cp .env.example .env && nano .env     # CRM_PASSWORD, SESSION_SECRET (openssl rand -hex 32), PORT=3100
   npm ci && npm run build
   ```
3. **Lancement avec PM2** :
   ```bash
   npm i -g pm2
   pm2 start npm --name bedolt-crm -- start
   pm2 save && pm2 startup          # redémarrage automatique au reboot
   ```
   Mise à jour : `git pull && npm ci && npm run build && pm2 restart bedolt-crm`.
4. **Reverse proxy + HTTPS** (cookie de session `secure` en production : HTTPS obligatoire).
   - *Nginx* :
     ```nginx
     server {
       server_name crm.bedolt.com;
       location / {
         proxy_pass http://127.0.0.1:3100;
         proxy_http_version 1.1;
         proxy_set_header Host $host;
         proxy_set_header X-Forwarded-Proto $scheme;
         proxy_buffering off;          # indispensable pour le chat IA en streaming
         proxy_read_timeout 300s;      # classement IA : requêtes longues
       }
     }
     ```
     puis `certbot --nginx -d crm.bedolt.com`.
   - *CyberPanel / OpenLiteSpeed* : créer le site `crm.bedolt.com`, SSL Let's Encrypt, puis un « Proxy Context » `/` → `http://127.0.0.1:3100`.
   - *Plesk / cPanel* : « Node.js app » (racine = dossier du projet, fichier de démarrage `npm start`, `PORT` en variable) ou règle proxy Apache/Nginx vers `127.0.0.1:3100`, SSL via Let's Encrypt.
5. **Sauvegarde quotidienne** (copie datée dans `backups/`, 30 jours conservés) :
   ```bash
   crontab -e
   30 3 * * * cd /var/www/bedolt-crm && /usr/bin/node scripts/backup.mjs >> backups/backup.log 2>&1
   ```
   Pense aussi à copier `backups/` hors du VPS de temps en temps.

## Connecter l'IA locale (Ollama sur ton PC) au VPS

Le CRM (VPS) doit joindre Ollama (PC maison) **sans ouvrir de port sur Internet**.

**Option A — Tailscale (recommandée)**
1. Installe Tailscale sur le PC et sur le VPS, connecte les deux au même compte (`tailscale up`).
2. Sur le PC, fais écouter Ollama sur le réseau : variable `OLLAMA_HOST=0.0.0.0:11434` (Windows : variable d'environnement système, puis redémarrer Ollama ; Linux : `systemctl edit ollama`). Le pare-feu du PC ne doit autoriser le port 11434 que pour l'interface Tailscale.
3. Relève l'IP Tailscale du PC (`tailscale ip -4`, du type `100.x.y.z`).
4. Dans le CRM : Réglages > IA > URL `http://100.x.y.z:11434` > « Tester la connexion » > choisis le modèle (ex. `qwen2.5`) > Enregistrer.

**Option B — Cloudflare Tunnel** : `cloudflared tunnel` sur le PC exposant `http://localhost:11434` sur un hostname privé protégé par Cloudflare Access (service token), puis l'URL du tunnel dans Réglages > IA. Ne publie jamais Ollama sans authentification.

**n8n** : dans Réglages > IA, choisis « Webhook n8n » et colle l'URL. Le CRM envoie `POST {system, message, history}` et attend `{reply}` (ou du texte). Pas de streaming ni d'outils dans ce mode.

Si l'IA est injoignable, tout le CRM fonctionne ; le chat affiche « IA hors ligne ». Si ton modèle gère mal le tool calling, passe Réglages > IA > « Accès aux données » sur « Contexte injecté ».

## À vérifier avant la première vraie recherche DENUE

- **Codes municipio** : `data/municipios-qroo.json` (Quintana Roo = entité 23). Je n'avais pas accès à inegi.org.mx depuis l'environnement de développement, donc les codes (ex. 005 Benito Juárez/Cancún, 008 Solidaridad/Playa del Carmen, 011 Puerto Morelos) sont saisis de mémoire : compare-les avec le *Catálogo Único de Claves Geoestadísticas* d'INEGI. Le champ « Ubicación » de chaque résultat affiche le municipio, pour un contrôle immédiat. Fichier modifiable sans toucher au code, et « Autre code… » permet d'en saisir un à la main.
- **Format des URL de l'API** (`lib/denue.ts`) : écrit d'après la documentation d'INEGI telle que je la connais (`Buscar`, `Nombre`, `BuscarAreaActEstr`), jamais appelé en réel. Utilise « Tester la connexion » puis une première recherche ; en cas d'erreur, le message INEGI s'affiche tel quel.

## Fonctionnement en bref

- **Aujourd'hui** (accueil) : compteurs appels (objectif 5) / WhatsApp (max 20), relances du jour, prospects à appeler.
- **Relances** : premier contact sans réponse (WhatsApp envoyé ou appel sans réponse) → statut « Contacté », relance à J+2 puis J+7. Un appel répondu passe en « A répondu » ; tout statut ≥ « A répondu » annule les relances.
- **WhatsApp** : `wa.me/52…` avec le modèle du Réglages (`{nom}` remplacé), numéros normalisés, journalisé + compteur ; bloqué (côté serveur aussi) à 20/jour.
- **Modèles de messages** : vides par défaut — c'est toi qui les écris (Réglages).
- **Fuseau des « jours »** : `America/Cancun` (`lib/constants.ts`).
- **Sécurité** : mot de passe unique, cookie HttpOnly signé (30 jours), toutes les pages et API protégées par `middleware.ts`. Le token DENUE n'est jamais renvoyé au navigateur.
