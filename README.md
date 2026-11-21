# Bedolt CRM

CRM interne (un seul utilisateur) pour Bedolt : prospection de commerces locaux (Riviera Maya), pipeline, relances,
WhatsApp en 1 clic, suivi clients, IA locale (Ollama / n8n). Interface en français, mobile d'abord, thème sombre.

**Stack** : Next.js 15 (App Router, TypeScript) · SQLite via `better-sqlite3` (SQL direct, schéma créé automatiquement
dans `lib/db.ts`) · `exceljs` pour l'import/export `.xlsx` · `zod` pour valider les entrées.

## Lancer en local

```bash
npm install
cp .env.example .env        # puis edite CRM_PASSWORD (et DENUE_TOKEN si tu l'as)
npm run dev                 # http://localhost:3000
```

Variables (`.env`, détail dans `.env.example`) : `CRM_PASSWORD` (obligatoire), `SESSION_SECRET` (**obligatoire en
production**, 32 caractères min., `openssl rand -hex 32`), `APP_URL` (**obligatoire en production**, ex.
`https://crm.bedolt.com` : base de toutes les redirections, jamais déduite de l'en-tête Host), `DENUE_TOKEN`, `DATABASE_PATH` (défaut `./data/crm.db`),
`PORT` (défaut 3100), `AI_ALLOWED_HOSTS`, `BACKUP_*`, `COOKIE_SECURE=false` seulement pour tester `npm start` en HTTP.

## Déployer / mettre à jour sur le VPS (CyberPanel, crm.bedolt.com)

Ne touche pas à bedolt.com : le CRM est une application Node à part, sur son propre sous-domaine, dans
`/var/www/bedolt-crm` (**jamais** sous un docroot : `deploy.sh` refuse de s'exécuter dans `/home/*/public_html`…).

```bash
curl -fsSL https://raw.githubusercontent.com/Zival126/Bedolt-CRM/main/scripts/deploy.sh -o /root/deploy.sh
sudo bash /root/deploy.sh --no-proxy
```

`deploy.sh` (idempotent, sert aussi de mise à jour) :
1. refuse un dossier situé sous un docroot web ;
2. crée l'utilisateur système **`bedoltcrm`** (sans shell, home `/var/lib/bedoltcrm`) : l'application ne tourne plus en root ;
3. **sauvegarde la base** (`backups/crm-…-predeploy-….db`) avant de toucher au code, et s'arrête si c'est impossible ;
4. met de côté les fichiers du dépôt modifiés localement (`backups/pre-deploy-…/`) avant `git reset --hard`.
   Les réglages locaux vivent hors du dépôt et ne sont jamais écrasés : `.env`, `data/` (base, `municipios-qroo.json`
   personnalisé), `backups/`, `logs/` ;
5. génère `SESSION_SECRET` et ajoute `APP_URL=https://crm.bedolt.com` s'ils manquent ; build sous `bedoltcrm` ;
6. arrête l'ancienne instance PM2 **root** si elle existe, puis lance PM2 sous `bedoltcrm` (`ecosystem.config.cjs`,
   écoute **127.0.0.1:3100 uniquement**) avec `pm2 startup` (service systemd `pm2-bedoltcrm`) ;
7. remplace l'ancien cron root par le cron de `bedoltcrm` (sauvegarde à 3 h 30) ;
8. applique les droits : `.env` 600 ; `data/`, `backups/`, `logs/` 700 ; leurs fichiers 600 ; propriétaire `bedoltcrm`.

Commandes utiles (l'utilisateur n'a pas de shell, on passe par `runuser`) :

```bash
runuser -u bedoltcrm -- env HOME=/var/lib/bedoltcrm pm2 ls
runuser -u bedoltcrm -- env HOME=/var/lib/bedoltcrm pm2 logs bedolt-crm
runuser -u bedoltcrm -- env HOME=/var/lib/bedoltcrm pm2 restart bedolt-crm
```

### CyberPanel / OpenLiteSpeed : proxy vers 127.0.0.1:3100

1. **Site** : *Websites > Create Website* → `crm.bedolt.com` (ou *Child Domain* de bedolt.com). Le docroot créé
   (`/home/crm.bedolt.com/public_html`) reste vide : le code est dans `/var/www/bedolt-crm`.
2. **SSL** : *SSL > Manage SSL* → `crm.bedolt.com` → *Issue SSL* (Let's Encrypt). L'enregistrement DNS `A crm` doit
   déjà pointer vers le VPS.
3. **External App + Proxy Context** : *Websites > List Websites > crm.bedolt.com > Manage > vHost Conf*, ajoute à la
   fin (garde le bloc `context /.well-known/acme-challenge` existant : il sert au renouvellement du certificat) :
   ```
   extprocessor bedoltcrm {
     type                    proxy
     address                 127.0.0.1:3100
     maxConns                100
     pcKeepAliveTimeout      60
     initTimeout             310
     retryTimeout            0
     respBuffer              0
   }

   context / {
     type                    proxy
     handler                 bedoltcrm
     addDefaultCharset       off
   }
   ```
   - `type proxy` = External App de type *Web Server* ; `respBuffer 0` = *Response Buffering : No* : **indispensable**
     pour que le chat IA s'affiche au fil de l'eau (la réponse envoie aussi `X-Accel-Buffering: no`).
   - `initTimeout 310` : le classement IA peut tenir une requête jusqu'à 300 s.
   - Équivalent dans la WebAdmin OpenLiteSpeed (port 7080) : *Virtual Hosts > crm.bedolt.com > External App > Add
     (Web Server)*, puis *Context > Add (Proxy)*, URI `/`, Web Server `bedoltcrm`.
4. **Redirection forcée vers HTTPS** : dans le même vHost Conf, remplace le bloc `rewrite` par :
   ```
   rewrite  {
     enable                  1
     autoLoadHtaccess        1
     rules                   <<<END_rules
   RewriteCond %{HTTPS} !=on
   RewriteCond %{REQUEST_URI} !^/\.well-known/acme-challenge/
   RewriteRule .* https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
     END_rules
   }
   ```
5. **Enregistrer** puis redémarrer proprement OpenLiteSpeed : `/usr/local/lsws/bin/lswsctrl restart`.
6. **Vérifier** :
   ```bash
   curl -sI http://crm.bedolt.com/login | head -3          # 301 vers https://
   curl -sI https://crm.bedolt.com/login | grep -iE "^HTTP|strict-transport|content-security"
   ```
   Chat en direct : ouvre le chat IA, pose une question longue — le texte doit apparaître progressivement. S'il
   arrive d'un bloc, vérifie `respBuffer 0` et désactive la compression dynamique pour `application/x-ndjson`
   (*WebAdmin > Server > Tuning > Compressible Types*).

### Pare-feu : bloquer le port 3100 depuis l'extérieur

L'application n'écoute que sur 127.0.0.1 ; le pare-feu est une seconde barrière. Repère celui qui est actif :

```bash
systemctl is-active firewalld; command -v csf && csf -v | head -1; command -v ufw && ufw status | head -1
```

- **firewalld** (par défaut avec CyberPanel) :
  ```bash
  firewall-cmd --permanent --remove-port=3100/tcp 2>/dev/null; firewall-cmd --permanent --add-rich-rule='rule family="ipv4" port port="3100" protocol="tcp" reject' && firewall-cmd --permanent --add-rich-rule='rule family="ipv6" port port="3100" protocol="tcp" reject' && firewall-cmd --reload
  ```
  Retour arrière : mêmes commandes avec `--remove-rich-rule`, puis `firewall-cmd --reload`.
- **CSF** (refuse par défaut tout port non listé) : vérifie que 3100 n'apparaît pas dans `TCP_IN` / `TCP6_IN`.
  ```bash
  grep -E '^TCP6?_IN' /etc/csf/csf.conf
  ```
  S'il y figure, retire-le de la liste dans `/etc/csf/csf.conf`, puis `csf -r`.
- **ufw** :
  ```bash
  ufw deny 3100/tcp && ufw status | grep 3100
  ```
  Retour arrière : `ufw delete deny 3100/tcp`.

Contrôle depuis ton PC (doit échouer / expirer) : `curl -m 5 http://IP_DU_VPS:3100/login`.

### Connexion : anti brute-force et fail2ban (optionnel)

Limite **par IP** stockée dans SQLite (survit aux redémarrages) : 5 échecs → 15 min de blocage, puis 30, 60 min… (max.
24 h ; oubli après 24 h sans échec). L'IP est la dernière valeur de `X-Forwarded-For` (ajoutée par OpenLiteSpeed) ;
elle n'est prise en compte que si l'application écoute sur 127.0.0.1 (sinon l'en-tête pourrait être forgé et la
limite devient globale, avec un avertissement dans les logs). Chaque échec est écrit dans `logs/auth.log` :
`2026-11-18 23:04:05 bedolt-crm login-failed ip=203.0.113.7` (UTC).

Pour bannir en plus au niveau du pare-feu avec fail2ban :

```bash
apt-get install -y fail2ban
cp /var/www/bedolt-crm/deploy/fail2ban/filter.d/bedolt-crm.conf /etc/fail2ban/filter.d/
cp /var/www/bedolt-crm/deploy/fail2ban/jail.d/bedolt-crm.local /etc/fail2ban/jail.d/
fail2ban-regex /var/www/bedolt-crm/logs/auth.log /etc/fail2ban/filter.d/bedolt-crm.conf
systemctl restart fail2ban && fail2ban-client status bedolt-crm
```

Avec firewalld, décommente `banaction = firewallcmd-rich-rules` dans la jail. Débannir : `fail2ban-client set bedolt-crm unbanip IP`.

**Verrouillé dehors ?** Remettre à zéro les blocages du CRM (table `login_guard`), sans outil supplémentaire et sans
redémarrage :

```bash
runuser -u bedoltcrm -- node /var/www/bedolt-crm/scripts/reset-login-guard.mjs            # toutes les IP
runuser -u bedoltcrm -- node /var/www/bedolt-crm/scripts/reset-login-guard.mjs 203.0.113.7  # une seule IP
```

### Sessions

Cookie `HttpOnly`, `Secure`, `SameSite=Lax`, 30 jours, signé (HMAC-SHA256) avec `SESSION_SECRET`. Il contient une
version de session : *Réglages > Sécurité > Déconnecter toutes les sessions* l'incrémente et invalide tous les cookies
existants. Changer `CRM_PASSWORD` (puis redémarrer) invalide aussi toutes les sessions. Sans `SESSION_SECRET` valide,
le serveur refuse de démarrer en production.

## Sauvegardes

- **Locales** : `scripts/backup.mjs` (cron de `bedoltcrm` à 3 h 30) → `backups/crm-AAAA-MM-JJ.db`, 30 jours, fichiers
  en 600. `deploy.sh` ajoute `backups/crm-…-predeploy-….db` (10 conservées) avant chaque mise à jour.
- **Contrôle** : `scripts/check-backup.sh` dit si la dernière sauvegarde quotidienne a moins de 26 h et est lisible
  (code 0 = OK, 1 = trop vieille / illisible, 2 = aucune) :
  ```bash
  runuser -u bedoltcrm -- bash /var/www/bedolt-crm/scripts/check-backup.sh
  ```
- **Copie hors VPS (optionnelle)**, chiffrée avant l'envoi :
  1. Sur ton PC : `age-keygen -o bedolt-backup.key` (garde ce fichier **hors du VPS**, c'est la seule clé qui
     déchiffre). Note la clé publique `age1…` affichée.
  2. Sur le VPS : `apt-get install -y age rclone`, puis configure le stockage sous l'utilisateur du CRM :
     `runuser -u bedoltcrm -- env HOME=/var/lib/bedoltcrm rclone config` (ex. remote `b2`, `s3`, `drive`…).
  3. Dans `.env` : `BACKUP_REMOTE=monremote:bedolt-crm` et `BACKUP_AGE_RECIPIENT=age1…`
     (ou `BACKUP_GPG_PASSPHRASE=…` si tu préfères gpg ; la phrase est alors sur le VPS).
  4. Test : `runuser -u bedoltcrm -- bash -c 'cd /var/www/bedolt-crm && node scripts/backup.mjs'`
     → « Copie chiffrée envoyée ». Sans clé de chiffrement, l'envoi est refusé (jamais de base en clair).

### Restaurer

```bash
cd /var/www/bedolt-crm
runuser -u bedoltcrm -- env HOME=/var/lib/bedoltcrm node scripts/backup.mjs --tag avant-restauration   # garde l'état actuel
runuser -u bedoltcrm -- env HOME=/var/lib/bedoltcrm pm2 stop bedolt-crm
rm -f data/crm.db-wal data/crm.db-shm
cp backups/crm-2026-11-17.db data/crm.db        # la sauvegarde choisie
chown bedoltcrm:bedoltcrm data/crm.db && chmod 600 data/crm.db
runuser -u bedoltcrm -- env HOME=/var/lib/bedoltcrm pm2 start bedolt-crm
```

Depuis la copie distante : `rclone copy monremote:bedolt-crm/crm-2026-11-17.db.age .` (sous `bedoltcrm`), puis sur
ton PC `age -d -i bedolt-backup.key -o crm.db crm-2026-11-17.db.age` (ou `gpg -d … > crm.db`), renvoie `crm.db`
sur le VPS et reprends les étapes ci-dessus.

## Personnaliser la liste des municipios

La valeur du dépôt est `config/municipios-qroo.json`. Pour la modifier sans qu'une mise à jour l'écrase :
`cp config/municipios-qroo.json data/municipios-qroo.json` puis édite la copie (fichier local, non versionné).

## Connecter l'IA locale (Ollama sur ton PC) au VPS

Le CRM (VPS) doit joindre Ollama (PC maison) **sans ouvrir de port sur Internet**.

**Option A — Tailscale (recommandée)**
1. Installe Tailscale sur le PC et sur le VPS, connecte les deux au même compte (`tailscale up`).
2. Sur le PC, fais écouter Ollama sur le réseau : variable `OLLAMA_HOST=0.0.0.0:11434` (Windows : variable d'environnement système, puis redémarrer Ollama ; Linux : `systemctl edit ollama`). Le pare-feu du PC ne doit autoriser le port 11434 que pour l'interface Tailscale.
3. Relève l'IP Tailscale du PC (`tailscale ip -4`, du type `100.x.y.z`).
4. Dans le CRM : Réglages > IA > URL `http://100.x.y.z:11434` (seules les IP Tailscale 100.64.0.0/10, les noms `*.ts.net`, les IP publiques et les hôtes de `AI_ALLOWED_HOSTS` sont acceptés : protection SSRF) > « Tester la connexion » > choisis le modèle (ex. `qwen2.5`) > Enregistrer.

**Option B — Cloudflare Tunnel** : `cloudflared tunnel` sur le PC exposant `http://localhost:11434` sur un hostname privé protégé par Cloudflare Access (service token), puis l'URL du tunnel dans Réglages > IA. Ne publie jamais Ollama sans authentification.

**n8n** : dans Réglages > IA, choisis « Webhook n8n » et colle l'URL (n8n sur le VPS lui-même : ajoute `AI_ALLOWED_HOSTS=127.0.0.1` ou `localhost` dans `.env`). Le CRM envoie `POST {system, message, history}` et attend `{reply}` (ou du texte). Pas de streaming ni d'outils dans ce mode.

Si l'IA est injoignable, tout le CRM fonctionne ; le chat affiche « IA hors ligne ». Si ton modèle gère mal le tool calling, passe Réglages > IA > « Accès aux données » sur « Contexte injecté ».

## À vérifier avant la première vraie recherche DENUE

- **Codes municipio** : `config/municipios-qroo.json` (ou ta copie `data/municipios-qroo.json`) (Quintana Roo = entité 23). Je n'avais pas accès à inegi.org.mx depuis l'environnement de développement, donc les codes (ex. 005 Benito Juárez/Cancún, 008 Solidaridad/Playa del Carmen, 011 Puerto Morelos) sont saisis de mémoire : compare-les avec le *Catálogo Único de Claves Geoestadísticas* d'INEGI. Le champ « Ubicación » de chaque résultat affiche le municipio, pour un contrôle immédiat. Fichier modifiable sans toucher au code, et « Autre code… » permet d'en saisir un à la main.
- **Format des URL de l'API** (`lib/denue.ts`) : `Buscar` et `Nombre` testés en réel (OK) ; `BuscarAreaActEstr` corrigé d'après les exemples de la doc INEGI (paramètre `/0/` avant la strate), à confirmer par une première recherche. Utilise « Tester la connexion » puis une première recherche ; en cas d'erreur, le message INEGI s'affiche tel quel.

## Import des prospects (Excel / CSV)

**Format prospects Bedolt**, reconnu automatiquement (en-têtes insensibles aux majuscules, accents, espaces) :
`Entreprise | Téléphone | Statut | Niche | Offre | Présence web | Angle | Notes | Note Google | Avis | Lien Google Maps | Message WhatsApp`.
« Notes » y contient la **zone** (champ `zone`), pas une note. Modèle : Import → « Modèle prospects Bedolt ». L'ancien
format (en-têtes `nom`, `telephone`…) et l'écran de correspondance restent disponibles.

- Le fichier est envoyé **une fois** et lu côté serveur (gardé 1 h en mémoire) ; aperçu paginé (50 lignes) avec raison de
  chaque erreur, doublons (téléphone normalisé, puis nom + ville, et doublons internes au fichier), avertissements
  (statut inconnu → À contacter…) et répartition par niche / zone / offre / ville. Colonnes inconnues ignorées et listées.
- Téléphone → `52XXXXXXXXXX` (WhatsApp = même numéro) · Avis « 124.0 » → 124 · fiche Google = « oui » si note ou avis,
  sinon « à vérifier » · ville déduite du `query=` du lien Maps, sinon la ville choisie sur l'écran d'import ·
  source = « Excel » + nom du fichier + date, avec un numéro de lot.
- Insertion dans **une transaction SQLite** (tout ou rien). Doublons : ignorer, ou mettre à jour (complète les champs
  vides, met à jour note / avis / message ; ne fait jamais reculer un statut et ne touche pas au journal).
- **Annuler un import** (résumé ou « Imports récents ») : supprime les fiches créées par ce lot qui n'ont ni action au
  journal ni changement de statut ; les autres sont conservées. Les fiches existantes mises à jour ne sont pas restaurées
  (utilise la sauvegarde `predeploy` / quotidienne si besoin).
- Limites : 5 Mo, 5 000 lignes, 100 colonnes. CSV : virgule, point-virgule ou tabulation, UTF-8 avec ou sans BOM
  (Windows-1252 accepté avec un avertissement : les emojis n'y existent pas).

**Migration** : les colonnes `niche, offre, presence_web, angle, zone, message_whatsapp, import_batch_id`, la table
`import_batches` et les index sont ajoutés automatiquement au démarrage (`lib/db.ts`, `ALTER TABLE ADD COLUMN`
uniquement, idempotent ; `PRAGMA user_version` = 2). Les fiches existantes ne sont pas modifiées. `deploy.sh` fait une
sauvegarde `predeploy` avant, puis vérifie la ligne `base prête (schéma v2/2)` dans les logs.

## Fonctionnement en bref

- **Aujourd'hui** (accueil) : compteurs appels (objectif 5) / WhatsApp (max 20), relances du jour, prospects à appeler.
- **Relances** : premier contact sans réponse (WhatsApp envoyé ou appel sans réponse) → statut « Contacté », relance à J+2 puis J+7. Un appel répondu passe en « A répondu » ; tout statut ≥ « A répondu » annule les relances.
- **WhatsApp** : `wa.me/52…`, numéros normalisés, journalisé + compteur ; bloqué (côté serveur aussi) à 20/jour. Premier message = message personnalisé de la fiche (colonne « Message WhatsApp ») s'il existe, sinon le modèle des Réglages ; relances J+2/J+7 = modèles des Réglages (`{nom}` remplacé). Le message est modifiable dans une fenêtre avant l'ouverture de wa.me.
- **Commerces** : pagination serveur (50 par page, compteur « X fiches » toujours affiché), filtres combinables gardés dans l'URL (statut, niche, zone, offre, ville, fiche Google, présence web, note min., avis min., lot d'import, message WhatsApp), tri (offre P1→P3, avis, note, date, score IA, nom), résumé cliquable par niche / zone. Vue par défaut « À appeler » : À contacter, triée par offre puis nb d'avis. Cartes sur mobile, tableau compact sur ordinateur. Sélection multiple (page ou tout le filtre) : changer le statut, l'offre, classer avec l'IA (1 000 max).
- **Pipeline** : Kanban et liste paginés (50 par colonne et par page, total réel affiché).
- **Modèles de messages** : vides par défaut — c'est toi qui les écris (Réglages).
- **Fuseau des « jours »** : `America/Cancun` (`lib/constants.ts`).
- **Sécurité** : mot de passe unique, limite de connexion par IP, cookie HttpOnly signé et révocable (30 jours). Double contrôle de session : `middleware.ts` puis `requireSession()` dans chaque page, route API et server action ; entrées validées avec zod (400 si invalide) ; en-têtes de sécurité et CSP à nonce ; URL IA filtrées (SSRF). Le token DENUE n'est jamais renvoyé au navigateur.
