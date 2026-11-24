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

## Carte des prospects (`/carte`)

- **Points** : couleur = statut (mêmes couleurs que l'appli) ; point plein = position du commerce / de l'adresse,
  point creux avec halo = position approximative (quartier / centre-ville, décalage stable pour éviter les superpositions).
  Clusters avec nombre, points individuels au zoom. Filtres identiques à Commerces, gardés dans l'URL (Perdu masqué par
  défaut), avec « Voir ces fiches en liste » et « Lancer le mode focus sur ces fiches ». Clic sur un point : bulle
  (panneau en bas sur téléphone) avec WhatsApp, appel, fiche, itinéraire et résultats en 1 clic (Annuler 10 s).
- **Fond** : Leaflet + markercluster servis par l'appli (npm, aucun CDN). Par défaut tuiles OpenStreetMap assombries
  en CSS (gratuites, sans clé, attribution affichée). `MAP_TILES=carto` : CARTO Dark Matter, qui renvoie désormais une
  tuile « API KEY REQUIRED » sans clé CARTO. La CSP n'autorise que l'hôte de tuiles choisi (`img-src`).
- **Positions** : DENUE et import (colonnes latitude / longitude, ou lien Google Maps contenant `!3d…!4d…` / `@lat,lng`)
  gardent les leurs. Les autres sont géocodées **côté serveur** par Nominatim (OpenStreetMap) : 1 requête/s max,
  User-Agent `BedoltCRM/1.0 (contacto@bedolt.com)`, réponses en cache (table `geo_cache`), résultats hors Quintana Roo
  rejetés. Ordre : adresse + ville → nom du commerce (texte du lien Maps) + ville → zone / colonia + ville → centre de
  la ville. File persistante (`geo_queue`) : reprend après redémarrage ; lancée après chaque import, ou via le bouton
  « Géolocaliser les fiches sans position » (progression « 340 / 1000 ») ou :
  ```bash
  cd /var/www/bedolt-crm && runuser -u bedoltcrm -- node scripts/geocode.mjs --enqueue   # puis --status / --watch
  ```
- **Correction manuelle** (fiche > Position) : coller des coordonnées ou un lien Google Maps complet, ou déplacer le
  point sur la mini-carte → source « manuelle », jamais écrasée par le géocodage.

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

## Tout le Mexique (DENUE, schéma v7)

- **Catalogue géographique national** (`config/geo-mx/`, **714 Ko**), généré par `node scripts/build-geo-mx.mjs`
  (`NODE_USE_ENV_PROXY=1` derrière un proxy ; ≈ 2 500 requêtes au service officiel, 10-30 min) depuis le Catálogo Único
  de Claves Geoestadísticas d'INEGI (Marco Geoestadístico) : **32 entidades, 2 478 municipios** (catalogue actuel, avec
  les municipios créés depuis le recensement 2020), **5 231 localidades** (urbaines, cabeceras, ≥ 2 500 hab., avec leur
  point) sur 296 643. Les autres localidades (rurales) sont demandées au service INEGI à la demande et gardées 30 jours
  en base (`geo_localidades`). `data/municipios-qroo.json` reste une surcharge possible pour le Quintana Roo.
- **Choix de la zone** (DENUE) : favoris en puces (*Réglages > DENUE > Zones favorites*), recherche instantanée sans
  accents ni majuscules (« monterrey », « cdmx », « playa », « merida »… ; synonymes CDMX / DF, Edomex, Playa,
  Cancún / Benito Juárez…), ou État → municipio → localidad. Dernière zone utilisée retenue par le navigateur.
  « Autour d'un point » : n'importe où au Mexique (clic sur la carte ou ville recherchée). Nom / mot-clé : n'importe
  quel État ou tout le pays (00, avec avertissement sur le volume).
- **Marché** : choix de l'État (défaut Quintana Roo ; 60 municipios les plus peuplés au plus) ou « Par État » (32).
- **Fiches** : colonnes `etat`, `etat_code`, `municipio`, `municipio_code` remplies depuis DENUE (CLEE / AreaGeo), la
  position ou la ville (catalogue). Filtre « État » dans Commerces et sur la Carte ; la carte se cale sur les fiches.
- **Géocodage** : plus limité au Quintana Roo ; le résultat Nominatim doit être dans l'État de la fiche (au Mexique à
  défaut). Les positions DENUE / import / manuelles restent prioritaires.
- **Overture** reste limité à la copie locale du Quintana Roo.
- **Migration v7** : les fiches existantes reçoivent État = Quintana Roo ; le municipio est complété au démarrage.

## Sources de leads (`/sources`) : Excel, DENUE, OpenStreetMap, Overture

Une page à onglets ; `/import` et `/denue` y redirigent. Toutes les sources passent par **le même dédoublonnage**
(`lib/sources.ts`) : identifiant de la source (CLEE / `osm_id` / `overture_id`), puis téléphone normalisé, puis nom proche
à moins de 100 m. **Ajouter un doublon = fusion** : seuls les champs vides de la fiche existante sont complétés (origine
notée), la source est ajoutée à la liste `sources` de la fiche (excel, denue, osm, overture, manuel) ; jamais de nouvelle
fiche, jamais de changement de statut ni du drapeau « ne pas contacter ». Les lignes « déjà dans le CRM » ont un bouton
« Compléter la fiche ». Catégories → niches : règles par défaut + table éditable (*Réglages > Sources*).

- **OpenStreetMap** (API Overpass, gratuite, sans clé) : préréglages par niche (= catégories OSM qui pointent vers la
  niche) + catégories libres, zone = une ville (cadre autour du centre officiel INEGI) ou la carte visible (65 km max).
  Côté serveur uniquement, User-Agent `BedoltCRM/1.0 (contacto@bedolt.com)`, une requête à la fois, cache 24 h,
  reprise sur 429 / 503 / 504 (Retry-After). `OVERPASS_URL` pour changer de serveur. © OpenStreetMap contributors (ODbL).
- **Overture Maps Places** : copie locale (table `overture_places`) de la zone Quintana Roo uniquement, recherche sans
  réseau (niche ou catégories précises, zone, téléphone / site / réseau / email, confiance min., fermés exclus).
  ```bash
  runuser -u bedoltcrm -- bash /var/www/bedolt-crm/scripts/overture-sync.sh     # 1re fois puis cron mensuel (le 3, 4 h 20)
  ```
  Moteur (`scripts/overture-setup.sh`, appelé par deploy.sh et à chaque synchronisation) : **DuckDB 1.5.6** épinglé
  (dernière 1.5.x stable disponible pour Python 3.10 / Ubuntu 22.04 ; les 2.x exigent un Python plus récent) dans
  `.venv-overture` (~80 Mo). Si pip échoue, repli automatique sur le **binaire CLI officiel** linux-amd64 de la même
  version (`data/duckdb/duckdb`, ~60 Mo), SHA-256 vérifié avant installation. Extensions `httpfs` et `spatial`
  (~100 Mo dans `data/overture/duckdb_extensions`, signées et vérifiées par DuckDB). La dernière ligne affichée est
  `DUCKDB OK 1.5.6 (python|cli)` ou `DUCKDB ERREUR : …` (journal : `logs/duckdb-install.log`).
  `scripts/overture_sync.py` lit les Parquet publics d'Overture (`s3://overturemaps-us-west-2`, sans compte) en ne
  téléchargeant que les blocs du cadre −89,5 / 17,8 / −86,65 / 21,7 : **~52 Mo** temporaires (supprimés après
  chargement), **~15 s à quelques minutes**, ~92 000 lieux (~35 Mo en base), contrôle affiché (coordonnées, catégories,
  téléphones, sites, emails, réseaux) ; transaction unique (remplace la version précédente).
  Jamais le monde entier (zone refusée hors Quintana Roo). © Overture Maps Foundation (CDLA Permissive 2.0 / ODbL).
- **Enrichissement** (fiches avec site et sans email) : file persistante comme le géocodage (`ENRICHER=off` pour couper),
  lancée après chaque ajout / import et par « Enrichir les fiches ». Page d'accueil + 2 pages de contact au plus,
  robots.txt respecté, 1 requête / seconde par domaine. Extrait emails (mailto, texte, protection Cloudflare), Facebook /
  Instagram / TikTok, liens wa.me (→ WhatsApp oui + numéro s'il diffère). Emails génériques ignorés. Champs vides
  seulement ; l'origine est affichée sur la fiche (« email trouvé sur sitio.com/contacto le … »).
  **Sécurité** (`lib/safe-fetch.ts`) : Internet public uniquement — DNS résolu avant la connexion et toutes les
  adresses vérifiées (refus loopback, privé, link-local dont 169.254.169.254, CGNAT / Tailscale, réservé), connexion sur
  l'IP vérifiée (anti DNS rebinding), redirections revérifiées (3 max), ports 80 / 443, http/https, 1 Mo, 8 s, texte
  seulement, aucun JavaScript exécuté.
- **Google Places** (optionnel) : seulement si `GOOGLE_PLACES_KEY` est dans `.env` → bouton « Vérifier sur Google » sur
  la fiche (existence, note, avis, site, téléphone). Compteur du mois dans *Réglages > Sources*. Aucune requête sans clé.
- **Stats** : par source, fiches, % téléphone / email / site / WhatsApp / réseau, taux de réponse et d'intérêt.

**Migration v6** (au démarrage, non destructive) : colonnes `sources, osm_id, overture_id, tiktok, horaires,
enrich_status, enrich_at, google_at, google_place_id` ; tables `field_origins, category_map, http_cache, enrich_queue,
overture_places, overture_meta, google_usage`. Seule donnée calculée : `sources` déduite de la source d'origine.

## DENUE (INEGI) : recherche avancée, veille, marché (Sources > DENUE)

Token dans *Réglages > DENUE* (jamais renvoyé au navigateur, absent des messages d'erreur et du cache). Toutes les
requêtes partent du serveur (`lib/denue.ts`), une à la fois, 350 ms minimum entre deux, délai d'expiration 30 s,
3 essais (réseau / 5xx / 429), réponses en cache 24 h (table `denue_cache`).

- **Méthodes** : `BuscarAreaActEstr` (zone + activité + strate, méthode principale), `Buscar` (autour d'un point,
  ≤ 5 000 m : clic sur la carte, « Ma position » ou « Chercher autour » depuis une fiche), `Nombre` / `BuscarEntidad`
  (nom / mot-clé au Quintana Roo), `Cuantificar` (« Compter d'abord » : volume et nombre de pages), `Ficha`
  (fiche > « Mettre à jour depuis DENUE »). Formats d'URL vérifiés sur la doc et par de vraies requêtes
  (`BuscarAreaActEstr` = 14 segments, le « 0 » avant la strate est l'`Id` d'établissement).
- **Pagination** : pages de 500 jusqu'à la page incomplète, progression en direct ; une panne en cours de route garde
  ce qui est lu et « Reprendre » relance sans redemander les pages déjà en cache.
- **Résultats** : liste + carte (nouveau = blanc, déjà dans le CRM = couleur du statut), filtres téléphone / email /
  site / strate / type / colonia / ouverts < 12 ou 24 mois / nouveaux / déjà dans le CRM. Dédoublonnage : CLEE, puis
  téléphone normalisé, puis même nom à moins de 100 m. « Ajouter la sélection » / « Ajouter tous les filtrés » : une
  transaction, statut À contacter, niche via *Mes niches*, zone = colonia, position DENUE, source « DENUE · date ».
- **Activités** : catalogue officiel SCIAN 2023 (`config/scian-2023.json`, 2 115 catégories + index des biens et
  services d'INEGI), recherche en espagnol ou en français (« ongles », « coiffure », « dentiste »…), multi-sélection.
  **Mes niches** (*Réglages > DENUE*) : libellé de niche du CRM → codes SCIAN.
- **Municipios / localidades** : Catálogo Único de Claves Geoestadísticas d'INEGI (`config/municipios-qroo.json`,
  `config/localidades-qroo.json`). INEGI nomme désormais le municipio 008 « Playa del Carmen » (ex-Solidaridad).
  Surcharge locale toujours possible : `data/municipios-qroo.json`. Régénérer les catalogues : `npm run catalogs`.
- **Recherches enregistrées et veille** : « Relancer chaque semaine » → le serveur vérifie toutes les heures et relance
  les recherches cochées tous les 7 jours (`DENUE_WATCH=off` pour couper). Seuls les CLEE jamais vus sont signalés
  (badge « N nouveaux » sur DENUE et Aujourd'hui) ; rien n'est ajouté sans toi.
- **Marché** : mes niches × municipios, établissements DENUE (une requête `Cuantificar`) vs fiches du CRM
  (contactées / clients). Un clic lance la recherche correspondante.
- **Limites DENUE** : email et site web souvent vides, téléphones parfois absents ou fixes ; date d'alta fournie
  seulement par la recherche « Zone + activité ». Vérifie sur Google Maps avant de contacter.

## Commerces : contacts, filtres, vues, export

- Fiche : téléphone, email (validé, « Écrire un email »), site, WhatsApp (inconnu / oui / non : « oui » après un
  envoi confirmé, « non » avec « Pas de WhatsApp »), Facebook / Instagram (lien ou @compte). Icônes 📞 ✉️ 🌐 WA.
- Puces de filtres (dans l'URL, aussi sur la Carte) : avec / sans email, site, téléphone, position ; WhatsApp
  oui / non / inconnu ; source ; « ne pas contacter ». Étiquette dans « Plus de filtres ».
- Tableau (ordinateur) : colonnes au choix et dans l'ordre voulu (« Colonnes »), tri en cliquant l'en-tête (2e clic :
  ordre inverse), ligne cliquable. Vues enregistrées en 1 clic. Cartes sur téléphone.
- **Export CSV** des fiches filtrées (colonnes visibles) : UTF-8 avec BOM, séparateur « ; » (Excel en français) ou
  « , » ; formules neutralisées.
- Actions groupées : statut, offre, IA, **ajouter une étiquette**, **⛔ ne pas contacter** (et retirer).
- **Ne pas contacter** : exclue de la file du jour, du mode focus, de la carte par défaut, de « À appeler » et de tout
  WhatsApp (bouton bloqué, refus serveur à la préparation et à l'enregistrement, y compris après une action groupée).
- Import Excel : colonnes email / correo, site / sitio web / web, facebook, instagram reconnues (aussi au format Bedolt).

**Migration v5** (au démarrage, `ADD COLUMN` / `CREATE … IF NOT EXISTS`, sous verrou) : colonnes `facebook, instagram,
wa_confirme, ne_pas_contacter, dnc_at, denue_num, denue_alta, denue_estrato, denue_sync` ; tables `denue_cache,
denue_searches, denue_seen, saved_views`. Seule donnée calculée : WhatsApp « oui » pour les fiches qui ont déjà reçu un
WhatsApp. `deploy.sh` vérifie la ligne `base prête (schéma vN/N)` (v6 depuis les sources de leads).

## Tests

```bash
npm test     # node:test, sans dépendance (Node ≥ 22.7) ; base SQLite jetable, réponses DENUE simulées
```
Réponses simulées au format réel (champs de la doc INEGI, erreur « No autorizado » capturée) : chaque méthode,
pagination, reprise, cache, Cuantificar, dédoublonnage, ajout groupé, veille, SCIAN FR/ES, filtres de contact, vues,
colonnes, CSV, « ne pas contacter », import.

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
sauvegarde `predeploy` avant, puis vérifie la ligne `base prête (schéma v3/3)` dans les logs.

**Migration v3** (cycle de vie orienté action, une seule fois, dans une transaction) : « Pas intéressé » → **Perdu** (motif
Pas intéressé) ; l'historique des statuts n'est pas réécrit (les anciennes lignes s'affichent « Pas intéressé (ancien) »).
Colonnes ajoutées : `perdu_motif, no_whatsapp, relance_n, next_step, next_date` (fiches), `step, result` (journal),
`motif` (historique) ; tables `daily_queue`, `queue_meta`, `undo_log`. Les fiches « Contacté » gardent leur relance ;
celles dont les deux relances étaient passées reviennent dans la file du jour.

## Fonctionnement en bref

- **Cycle de vie** : À contacter → Contacté → A répondu → Intéressé → Payé, plus **Perdu** (motif : Pas intéressé, Pas de
  réponse, Pas de WhatsApp / injoignable, Numéro invalide, Autre). Une fiche perdue sort de toutes les files, reste
  consultable (Commerces > Perdues) et se réactive depuis sa fiche (retour au statut d'avant).
- **Aujourd'hui** (accueil) = **file du jour**, générée selon *Réglages > Objectifs*, figée pour la journée (fuseau
  America/Cancun) : 1. Réponses à traiter (« A répondu » sans suite, rappels / étapes dont la date est arrivée) ;
  2. Relances dues J+2 / J+7 (limite « Relances/jour », les plus anciennes d'abord) ; 3. Nouveaux à contacter (filtre de
  la file, limite « Nouveaux WhatsApp/jour », triés par offre puis avis). Un prospect traité disparaît ; les nouveaux
  éligibles s'ajoutent en fin de bloc, la liste ne se réorganise pas. Objectif atteint → bloc replié, « En faire plus »
  jusqu'à la limite dure.
- **Résultats en 1 clic** (file, mode focus, fiche) : WhatsApp envoyé (ouvre wa.me avec le message de la fiche ou le
  modèle, puis « Envoyé ? »), Pas de WhatsApp (→ liste « À appeler »), A répondu (→ Intéressé / Pas intéressé / À
  rappeler le…), Pas répondu (→ relance suivante), Intéressé (+ prochaine étape / date), Perdu (motif), Appeler (+ résultat
  de l'appel). Chaque résultat est journalisé (date, type, résultat, étape) avec un toast **Annuler** (10 s).
- **Relances** : premier WhatsApp → Contacté, relance J+2, puis J+7. Après J+7 sans réponse, la file propose « Perdu · pas
  de réponse » en 1 clic (3 jours plus tard) — jamais automatiquement.
- **Mode focus** (`/focus`) : un prospect en plein écran, message modifiable, 3 dernières actions, compteur, « Passer »
  (fin de file, rien n'est journalisé). Clavier : W WhatsApp, R a répondu, N pas répondu, P perdu, → passer.
- **Objectifs** (Réglages) : nouveaux WhatsApp/jour (20), limite dure (30, **bloquée côté serveur** : préparation et
  enregistrement d'un premier WhatsApp refusés au-delà), relances/jour (20), filtre de la file (niches, zones, offres,
  villes, fiche Google, avis min.) et ordre. Avertissement au-delà de 25. Appels sans quota.
- **Stats** (ex-« Semaine ») : entonnoir de la semaine, taux de réponse, perdus par motif.
- **Commerces** (détails v5 ci-dessus) : pagination serveur (50 par page, compteur « X fiches » toujours affiché), filtres combinables gardés dans l'URL (statut, niche, zone, offre, ville, fiche Google, présence web, note min., avis min., lot d'import, message WhatsApp), tri (offre P1→P3, avis, note, date, score IA, nom), résumé cliquable par niche / zone. Vues : À contacter (défaut, triée par offre puis nb d'avis), À appeler (numéros sans WhatsApp), Perdues, Toutes. Cartes sur mobile, tableau compact sur ordinateur. Sélection multiple (page ou tout le filtre) : changer le statut, l'offre, classer avec l'IA (1 000 max).
- **Pipeline** : Kanban et liste paginés (50 par colonne et par page, total réel affiché), colonne Perdu repliée ; vers Perdu, le motif est demandé.
- **Modèles de messages** : vides par défaut — c'est toi qui les écris (Réglages).
- **Fuseau des « jours »** : `America/Cancun` (`lib/constants.ts`).
- **Sécurité** : mot de passe unique, limite de connexion par IP, cookie HttpOnly signé et révocable (30 jours). Double contrôle de session : `middleware.ts` puis `requireSession()` dans chaque page, route API et server action ; entrées validées avec zod (400 si invalide) ; en-têtes de sécurité et CSP à nonce ; URL IA filtrées (SSRF). Le token DENUE n'est jamais renvoyé au navigateur.
