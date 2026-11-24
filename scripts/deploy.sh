#!/usr/bin/env bash
# Déploiement / mise à jour du CRM Bedolt sur un VPS Debian/Ubuntu (à lancer en root).
#
#   curl -fsSL https://raw.githubusercontent.com/Zival126/Bedolt-CRM/main/scripts/deploy.sh -o deploy.sh
#   sudo bash deploy.sh --no-proxy           # CyberPanel / OpenLiteSpeed (le proxy se règle dans le panel, voir README)
#   sudo bash deploy.sh                      # serveur sans panel : installe aussi Nginx + HTTPS
#
# Variables optionnelles : DOMAIN (crm.bedolt.com) · APP_DIR (/var/www/bedolt-crm) · PORT (3100) · EMAIL (Let's Encrypt)
#                          REPO · BRANCH (main) · APP_USER (bedoltcrm) · APP_HOME (/var/lib/bedoltcrm)
#                          SKIP_PREDEPLOY_BACKUP=1 (déconseillé : continuer même si la sauvegarde préalable échoue)
#
# Idempotent : le relancer = mise à jour. L'application tourne sous l'utilisateur système APP_USER (jamais root).
# Si une ancienne installation tourne sous PM2 root, elle est migrée (sauvegarde, chown, arrêt de l'ancien process,
# suppression de l'ancien cron root, redémarrage sous APP_USER). Ne touche jamais à bedolt.com.
set -euo pipefail
umask 027

DOMAIN="${DOMAIN:-crm.bedolt.com}"
APP_DIR="${APP_DIR:-/var/www/bedolt-crm}"
PORT="${PORT:-3100}"
REPO="${REPO:-https://github.com/Zival126/Bedolt-CRM.git}"
BRANCH="${BRANCH:-main}"
EMAIL="${EMAIL:-}"
APP_USER="${APP_USER:-bedoltcrm}"
APP_HOME="${APP_HOME:-/var/lib/$APP_USER}"
PROXY=1
[ "${1:-}" = "--no-proxy" ] && PROXY=0

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[X] %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "Lance ce script en root (sudo bash deploy.sh)."
command -v apt-get >/dev/null || die "Ce script suppose Debian/Ubuntu (apt)."
export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------------------------------------------
say "0/9 Vérification de l'emplacement ($APP_DIR)"
APP_REAL="$(realpath -m "$APP_DIR")"
case "$APP_REAL/" in
  */public_html/*|*/htdocs/*|*/httpdocs/*|/var/www/html/*|/usr/local/lsws/*|/srv/www/*|/home/*/www/*)
    die "REFUS : $APP_REAL est dans (ou sous) un docroot web. Le serveur web pourrait y servir directement .env, la base
    SQLite et les sauvegardes. Place le CRM hors de tout docroot, par exemple APP_DIR=/var/www/bedolt-crm." ;;
esac
for conf in /usr/local/lsws/conf/vhosts/*/vhost.conf; do
  [ -f "$conf" ] || continue
  vh="$(basename "$(dirname "$conf")")"
  dr="$(awk '$1=="docRoot"{print $2; exit}' "$conf" | sed -e "s#\$VH_ROOT#/home/$vh#" -e "s#\$VH_NAME#$vh#")"
  case "$dr" in /*) case "$APP_REAL/" in "$(realpath -m "$dr")"/*) die "REFUS : $APP_REAL est sous le docroot OpenLiteSpeed du site $vh ($dr)." ;; esac ;; esac
done
echo "OK : $APP_REAL n'est pas sous un docroot connu."

say "1/9 Paquets système"
apt-get update -qq
# python3-venv : environnement isolé de la synchronisation Overture (DuckDB), voir scripts/overture-sync.sh
apt-get install -y -qq git curl ca-certificates build-essential python3 python3-venv openssl >/dev/null

say "2/9 Node.js (>= 20) et PM2"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node $(node -v), npm $(npm -v)"
command -v pm2 >/dev/null || npm i -g pm2 >/dev/null
PM2="$(command -v pm2)"
NODE="$(command -v node)"

say "3/9 Utilisateur système $APP_USER"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_HOME" --create-home --shell /usr/sbin/nologin "$APP_USER"
  echo "Utilisateur $APP_USER créé (home $APP_HOME, sans shell de connexion)."
else
  echo "Utilisateur $APP_USER déjà présent."
fi
mkdir -p "$APP_HOME"; chown "$APP_USER:$APP_USER" "$APP_HOME"; chmod 700 "$APP_HOME"
as_user() { (cd "${RUN_DIR:-$APP_HOME}" && runuser -u "$APP_USER" -- env HOME="$APP_HOME" PATH="$PATH" "$@"); }

fix_perms() {
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  chmod 750 "$APP_DIR"
  mkdir -p "$APP_DIR/data" "$APP_DIR/backups" "$APP_DIR/logs"
  chown "$APP_USER:$APP_USER" "$APP_DIR/data" "$APP_DIR/backups" "$APP_DIR/logs"
  chmod 700 "$APP_DIR/data" "$APP_DIR/backups" "$APP_DIR/logs"
  find "$APP_DIR/data" "$APP_DIR/backups" "$APP_DIR/logs" -type d -exec chmod 700 {} +
  find "$APP_DIR/data" "$APP_DIR/backups" "$APP_DIR/logs" -type f -exec chmod 600 {} +
  [ -f "$APP_DIR/.env" ] && chmod 600 "$APP_DIR/.env"
  return 0
}

say "4/9 Code ($APP_DIR, branche $BRANCH)"
RESTORE_MUNI=""
if [ -d "$APP_DIR/.git" ]; then
  fix_perms   # migration éventuelle depuis une installation root
  RUN_DIR="$APP_DIR"
  # 4a. Sauvegarde de la base AVANT toute modification du code
  if [ -f "$APP_DIR/data/crm.db" ] || grep -qE '^DATABASE_PATH=.+' "$APP_DIR/.env" 2>/dev/null; then
    if RUN_DIR="$APP_DIR" as_user "$NODE" scripts/backup.mjs --tag predeploy; then
      echo "Sauvegarde préalable faite dans $APP_DIR/backups/."
    elif [ "${SKIP_PREDEPLOY_BACKUP:-0}" = "1" ]; then
      warn "Sauvegarde préalable impossible — on continue (SKIP_PREDEPLOY_BACKUP=1)."
    else
      die "Sauvegarde préalable impossible : arrêt, rien n'a été modifié. (Forcer : SKIP_PREDEPLOY_BACKUP=1)"
    fi
  fi
  # 4b. Fichiers suivis modifiés localement : on les met de côté au lieu de les perdre
  STAMP="$(date +%Y%m%d-%H%M%S)"
  CHANGED="$(RUN_DIR="$APP_DIR" as_user git diff --name-only HEAD || true)"
  if [ -n "$CHANGED" ]; then
    SAVE="$APP_DIR/backups/pre-deploy-$STAMP"
    mkdir -p "$SAVE"
    RUN_DIR="$APP_DIR" as_user git diff HEAD > "$SAVE/modifications-locales.patch" || true
    while IFS= read -r f; do
      [ -f "$APP_DIR/$f" ] && mkdir -p "$SAVE/$(dirname "$f")" && cp -p "$APP_DIR/$f" "$SAVE/$f"
    done <<< "$CHANGED"
    warn "Fichiers du dépôt modifiés localement : copiés dans $SAVE, puis REMPLACÉS par la version du dépôt :"
    echo "$CHANGED" | sed 's/^/      /'
    # Ancien emplacement de la liste des municipios : la version locale devient la surcharge data/municipios-qroo.json
    if echo "$CHANGED" | grep -qx "data/municipios-qroo.json"; then RESTORE_MUNI="$SAVE/data/municipios-qroo.json"; fi
  fi
  # 4c. Mise à jour. Les réglages locaux (data/, backups/, logs/, .env) ne sont pas suivis par git : intacts.
  RUN_DIR="$APP_DIR" as_user git fetch -q origin "$BRANCH"
  RUN_DIR="$APP_DIR" as_user git reset -q --hard "origin/$BRANCH"
  if [ -n "$RESTORE_MUNI" ] && [ -f "$RESTORE_MUNI" ] && [ ! -f "$APP_DIR/data/municipios-qroo.json" ]; then
    cp "$RESTORE_MUNI" "$APP_DIR/data/municipios-qroo.json"
    echo "Ta liste de municipios modifiée est conservée dans data/municipios-qroo.json."
  fi
else
  [ -e "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ] && die "$APP_DIR existe et n'est pas un dépôt git : arrêt."
  mkdir -p "$APP_DIR"; chown "$APP_USER:$APP_USER" "$APP_DIR"
  RUN_DIR="$APP_HOME" as_user git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

say "5/9 Configuration (.env)"
if [ ! -f .env ]; then
  GENERATED=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)
  read -r -s -p "Mot de passe du CRM (Entrée = en générer un) : " PASS < /dev/tty || PASS=""
  echo
  PASS="${PASS:-$GENERATED}"
  ( umask 077; cat > .env <<ENV
CRM_PASSWORD=$PASS
SESSION_SECRET=$(openssl rand -hex 32)
DENUE_TOKEN=
DATABASE_PATH=./data/crm.db
APP_URL=https://$DOMAIN
PORT=$PORT
COOKIE_SECURE=true
ENV
  )
  echo "Mot de passe du CRM : $PASS   (noté dans $APP_DIR/.env — change-le là si besoin)"
else
  echo ".env existant conservé."
  PORT="$(grep -E '^PORT=' .env | cut -d= -f2 || true)"; PORT="${PORT:-3100}"
  CUR_SECRET="$(grep -E '^SESSION_SECRET=' .env | cut -d= -f2- || true)"
  if [ "${#CUR_SECRET}" -lt 32 ]; then
    NEW_SECRET="$(openssl rand -hex 32)"
    if grep -qE '^SESSION_SECRET=' .env; then sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$NEW_SECRET|" .env
    else printf '\nSESSION_SECRET=%s\n' "$NEW_SECRET" >> .env; fi
    warn "SESSION_SECRET absent ou trop court : un nouveau a été généré (obligatoire désormais). Tu devras te reconnecter."
  fi
  CUR_URL="$(grep -E '^APP_URL=' .env | cut -d= -f2- | tr -d '[:space:]' || true)"
  if [ -z "$CUR_URL" ]; then
    if grep -qE '^APP_URL=' .env; then sed -i "s|^APP_URL=.*|APP_URL=https://$DOMAIN|" .env
    else printf '\nAPP_URL=https://%s\n' "$DOMAIN" >> .env; fi
    warn "APP_URL absent : ajouté APP_URL=https://$DOMAIN (base de toutes les redirections, obligatoire)."
  fi
fi
fix_perms

say "6/9 Build (sous $APP_USER)"
RUN_DIR="$APP_DIR" as_user npm ci --no-audit --no-fund
RUN_DIR="$APP_DIR" as_user npm run build

say "7/9 Lancement PM2 sous $APP_USER (ancienne instance root arrêtée si présente)"
# On n'interroge PM2 root que s'il tourne ou s'il ressusciterait bedolt-crm au reboot (sinon `pm2 describe`
# démarrerait inutilement un démon root).
ROOT_PM2_RUNNING=0
[ -f /root/.pm2/pm2.pid ] && kill -0 "$(cat /root/.pm2/pm2.pid)" 2>/dev/null && ROOT_PM2_RUNNING=1
if { [ "$ROOT_PM2_RUNNING" = 1 ] || grep -qs '"bedolt-crm"' /root/.pm2/dump.pm2; } \
   && HOME=/root "$PM2" describe bedolt-crm >/dev/null 2>&1; then
  echo "Ancienne instance PM2 root trouvée : arrêt et suppression."
  HOME=/root "$PM2" delete bedolt-crm >/dev/null
  HOME=/root "$PM2" save --force >/dev/null
  if [ "$(HOME=/root "$PM2" jlist 2>/dev/null | tr -d '[:space:]')" = "[]" ]; then
    HOME=/root "$PM2" kill >/dev/null 2>&1 || true
    HOME=/root "$PM2" unstartup systemd >/dev/null 2>&1 || true
    echo "PM2 root ne gérait plus rien : démon root arrêté et retiré du démarrage."
  else
    warn "PM2 root gère d'autres applications : on le laisse en place (seul bedolt-crm a été retiré)."
  fi
fi
fix_perms   # au cas où l'ancien process root aurait créé des fichiers entre-temps
# delete + start (et non restart) : PM2 relit alors les arguments d'ecosystem.config.cjs (-H 127.0.0.1),
# même si une ancienne version modifiée à la main est encore en mémoire.
ERR_LOG="$APP_HOME/.pm2/logs/bedolt-crm-error.log"
OUT_LOG="$APP_HOME/.pm2/logs/bedolt-crm-out.log"
LOG_START=$(( $(wc -l < "$ERR_LOG" 2>/dev/null || echo 0) + 1 ))
OUT_START=$(( $(wc -l < "$OUT_LOG" 2>/dev/null || echo 0) + 1 ))
RUN_DIR="$APP_DIR" as_user "$PM2" delete bedolt-crm >/dev/null 2>&1 || true
RUN_DIR="$APP_DIR" as_user "$PM2" start ecosystem.config.cjs
RUN_DIR="$APP_DIR" as_user "$PM2" save >/dev/null
env PATH="$PATH" "$PM2" startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null \
  || warn "pm2 startup a échoué : le CRM ne redémarrera pas seul au reboot (vérifie systemctl status pm2-$APP_USER)."
APP_URL_ENV="$(grep -E '^APP_URL=' .env | cut -d= -f2- | tr -d '[:space:]' | sed 's|/*$||')"
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -fsS -o /dev/null -m 3 "http://127.0.0.1:$PORT/login" 2>/dev/null && break; sleep 2; done
if curl -fsS -o /dev/null -m 10 "http://127.0.0.1:$PORT/login"; then echo "L'application répond sur 127.0.0.1:$PORT"
else warn "Pas de réponse sur 127.0.0.1:$PORT -> runuser -u $APP_USER -- env HOME=$APP_HOME pm2 logs bedolt-crm"; fi
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "^127\.0\.0\.1:$PORT\$"; then echo "Écoute : 127.0.0.1:$PORT uniquement."
else warn "Le CRM n'écoute pas sur 127.0.0.1:$PORT (ss -ltnp | grep $PORT)."; fi
# Redirection telle que la verra le navigateur derrière OpenLiteSpeed
LOC="$(curl -sI -m 10 -H "Host: $DOMAIN" -H "X-Forwarded-Proto: https" -H "X-Forwarded-For: 192.0.2.1" "http://127.0.0.1:$PORT/" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')"
if [ "$LOC" = "$APP_URL_ENV/login" ]; then echo "Redirection OK : / -> $LOC"
else warn "Redirection inattendue : / -> '${LOC:-aucune}' (attendu $APP_URL_ENV/login)"; fi
# Migrations SQLite (lib/db.ts) : appliquées au démarrage, avant la première requête.
MIG="$(tail -n +"$OUT_START" "$OUT_LOG" 2>/dev/null | grep -o 'base prête (schéma v[0-9]*/[0-9]*)' | tail -1 || true)"
# Version attendue = SCHEMA_VERSION de lib/db.ts (v6 : sources multiples, OSM / Overture, enrichissement).
EXPECTED_SCHEMA="$(grep -oE 'SCHEMA_VERSION = [0-9]+' lib/db.ts | grep -oE '[0-9]+' || true)"
if [ -n "$MIG" ]; then
  echo "Migration : $MIG"
  if echo "$MIG" | grep -qE "v${EXPECTED_SCHEMA:-[0-9]+}/${EXPECTED_SCHEMA:-[0-9]+}\)"; then
    echo "Schéma v${EXPECTED_SCHEMA} appliqué (v6 : sources multiples par fiche, overture_places, file d'enrichissement, origine des infos)."
  else warn "Schéma de base incomplet ($MIG, attendu v$EXPECTED_SCHEMA) : voir les logs PM2."; fi
  GEO="$(tail -n +"$OUT_START" "$OUT_LOG" 2>/dev/null | grep -o 'géocodage : worker démarré.*' | tail -1 || true)"
  [ -n "$GEO" ] && echo "Géocodage : ${GEO#géocodage : }" || warn "Worker de géocodage non signalé dans les logs (GEOCODER=off ?)."
  WATCH="$(tail -n +"$OUT_START" "$OUT_LOG" 2>/dev/null | grep -o 'veille DENUE : vérification.*' | tail -1 || true)"
  [ -n "$WATCH" ] && echo "Veille DENUE : ${WATCH#veille DENUE : }" || warn "Veille DENUE non signalée dans les logs (DENUE_WATCH=off ?)."
  ENR="$(tail -n +"$OUT_START" "$OUT_LOG" 2>/dev/null | grep -o 'enrichissement : worker démarré.*' | tail -1 || true)"
  [ -n "$ENR" ] && echo "Enrichissement : ${ENR#enrichissement : }" || warn "Worker d'enrichissement non signalé dans les logs (ENRICHER=off ?)."
else warn "Ligne « base prête » absente des logs : vérifie runuser -u $APP_USER -- env HOME=$APP_HOME pm2 logs bedolt-crm"; fi
if [ -f "$ERR_LOG" ] && tail -n +"$LOG_START" "$ERR_LOG" | grep -E "ATTENTION|REFUSÉ"; then
  warn "Avertissement(s) au démarrage ci-dessus : corrige .env puis relance."
else echo "Vérifications au démarrage : aucun avertissement."; fi

say "8/9 Tâches planifiées (cron de $APP_USER) : sauvegarde, Overture"
if crontab -l 2>/dev/null | grep -qF "scripts/backup.mjs"; then
  { crontab -l 2>/dev/null | grep -vF "scripts/backup.mjs" || true; } | crontab -
  echo "Ancien cron de sauvegarde root supprimé."
fi
CRON="30 3 * * * cd $APP_DIR && umask 077 && $NODE scripts/backup.mjs >> backups/backup.log 2>&1"
{ crontab -u "$APP_USER" -l 2>/dev/null | grep -vF "scripts/backup.mjs" || true; echo "$CRON"; } | crontab -u "$APP_USER" -
echo "Cron : $CRON"
# Overture Maps : moteur DuckDB (module Python épinglé, sinon binaire CLI officiel vérifié), puis synchronisation mensuelle.
mkdir -p "$APP_DIR/logs" "$APP_DIR/data" && chown "$APP_USER:$APP_USER" "$APP_DIR/logs" "$APP_DIR/data"
DUCK="$(RUN_DIR="$APP_DIR" as_user bash scripts/overture-setup.sh 2>&1 | tail -n 1 || true)"
case "$DUCK" in
  "DUCKDB OK "*) echo "Overture : ${DUCK#DUCKDB OK }" ;;
  *) warn "Overture : ${DUCK:-moteur DuckDB non installé} (journal : $APP_DIR/logs/duckdb-install.log)" ;;
esac
OCRON="20 4 3 * * cd $APP_DIR && umask 077 && bash scripts/overture-sync.sh >> logs/overture.log 2>&1"
{ crontab -u "$APP_USER" -l 2>/dev/null | grep -vF "scripts/overture-sync.sh" || true; echo "$OCRON"; } | crontab -u "$APP_USER" -
echo "Cron : $OCRON"
OV="$(RUN_DIR="$APP_DIR" as_user "$NODE" -e 'const D=require("better-sqlite3");const d=new D(process.argv[1],{readonly:true});try{console.log(d.prepare("SELECT COUNT(*) n FROM overture_places").get().n)}catch{console.log(0)}' "$APP_DIR/data/crm.db" 2>/dev/null || echo 0)"
[ "${OV:-0}" -gt 0 ] && echo "Overture : $OV lieux en base." || warn "Overture : aucune donnée. Première synchronisation : runuser -u $APP_USER -- bash $APP_DIR/scripts/overture-sync.sh"

say "9/9 Reverse proxy + HTTPS"
HOLDER="$(ss -ltnp 2>/dev/null | awk '$4 ~ /:80$/ {print $NF}' | head -1 || true)"
if [ "$PROXY" -eq 0 ] || { [ -n "$HOLDER" ] && ! echo "$HOLDER" | grep -q nginx; }; then
  [ "$PROXY" -eq 1 ] && echo "Le port 80 est déjà utilisé par : $HOLDER — je ne touche pas à ce serveur web."
  echo "Configure le proxy dans ton panel vers http://127.0.0.1:$PORT pour $DOMAIN (README, section CyberPanel)."
else
  apt-get install -y -qq nginx certbot python3-certbot-nginx >/dev/null
  cat > "/etc/nginx/sites-available/$DOMAIN" <<NGINX
server {
  listen 80;
  server_name $DOMAIN;
  client_max_body_size 6m;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;        # chat IA en streaming
    proxy_read_timeout 300s;    # classement IA
  }
}
NGINX
  ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
  nginx -t && systemctl reload nginx
  if getent hosts "$DOMAIN" | grep -q .; then
    CB=(--nginx -d "$DOMAIN" --redirect --agree-tos --non-interactive)
    if [ -n "$EMAIL" ]; then CB+=(-m "$EMAIL"); else CB+=(--register-unsafely-without-email); fi
    certbot "${CB[@]}" || warn "Certbot a échoué (DNS ?). Relance : certbot --nginx -d $DOMAIN"
  else
    warn "Le DNS de $DOMAIN ne résout pas encore. Crée l'enregistrement A puis : certbot --nginx -d $DOMAIN"
  fi
fi

say "Terminé"
FW=""
systemctl is-active --quiet firewalld 2>/dev/null && FW="firewalld"
command -v csf >/dev/null 2>&1 && csf -v >/dev/null 2>&1 && FW="${FW:+$FW + }CSF"
command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active" && FW="${FW:+$FW + }ufw"
FW="${FW:-aucun pare-feu actif détecté}"
echo "CRM : https://$DOMAIN   ·   process PM2 sous $APP_USER, écoute 127.0.0.1:$PORT"
echo "Pare-feu détecté : $FW -> bloque aussi le port $PORT depuis l'extérieur (README, section Pare-feu)."
echo "Logs : runuser -u $APP_USER -- env HOME=$APP_HOME pm2 logs bedolt-crm"
echo "Vérifier les sauvegardes : runuser -u $APP_USER -- bash $APP_DIR/scripts/check-backup.sh"
