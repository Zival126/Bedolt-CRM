#!/usr/bin/env bash
# Déploiement / mise à jour du CRM Bedolt sur un VPS Debian/Ubuntu (à lancer en root).
#
#   curl -fsSL https://raw.githubusercontent.com/Zival126/Bedolt-CRM/main/scripts/deploy.sh -o deploy.sh
#   sudo bash deploy.sh                      # installation complète ou mise à jour
#   sudo bash deploy.sh --no-proxy           # sans toucher à Nginx/HTTPS (CyberPanel, Plesk, cPanel...)
#
# Variables optionnelles : DOMAIN (crm.bedolt.com) · APP_DIR (/var/www/bedolt-crm) · PORT (3100)
#                          EMAIL (pour Let's Encrypt) · REPO · BRANCH (main)
# Le script est idempotent : le relancer = mise à jour (git pull, build, restart). Il ne touche jamais à bedolt.com.
set -euo pipefail

DOMAIN="${DOMAIN:-crm.bedolt.com}"
APP_DIR="${APP_DIR:-/var/www/bedolt-crm}"
PORT="${PORT:-3100}"
REPO="${REPO:-https://github.com/Zival126/Bedolt-CRM.git}"
BRANCH="${BRANCH:-main}"
EMAIL="${EMAIL:-}"
PROXY=1
[ "${1:-}" = "--no-proxy" ] && PROXY=0

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Lance ce script en root (sudo bash deploy.sh)."; exit 1; }
command -v apt-get >/dev/null || { echo "Ce script suppose Debian/Ubuntu (apt)."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "1/7 Paquets système"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates build-essential python3 openssl >/dev/null

say "2/7 Node.js (>= 20)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node $(node -v), npm $(npm -v)"
command -v pm2 >/dev/null || npm i -g pm2 >/dev/null

say "3/7 Code ($APP_DIR)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH" && git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  mkdir -p "$(dirname "$APP_DIR")"
  git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

say "4/7 Configuration (.env)"
if [ ! -f .env ]; then
  GENERATED=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)
  read -r -s -p "Mot de passe du CRM (Entrée = en générer un) : " PASS < /dev/tty || PASS=""
  echo
  PASS="${PASS:-$GENERATED}"
  cat > .env <<ENV
CRM_PASSWORD=$PASS
SESSION_SECRET=$(openssl rand -hex 32)
DENUE_TOKEN=
DATABASE_PATH=./data/crm.db
PORT=$PORT
COOKIE_SECURE=true
ENV
  chmod 600 .env
  echo "Mot de passe du CRM : $PASS   (noté dans $APP_DIR/.env — change-le là si besoin)"
else
  echo ".env existant conservé."
  PORT="$(grep -E '^PORT=' .env | cut -d= -f2 || true)"; PORT="${PORT:-3100}"
fi

say "5/7 Build"
npm ci --no-audit --no-fund
npm run build

say "6/7 Lancement (PM2)"
if pm2 describe bedolt-crm >/dev/null 2>&1; then
  pm2 restart bedolt-crm --update-env
else
  PORT="$PORT" pm2 start npm --name bedolt-crm -- start
fi
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
sleep 3
if curl -fsS -o /dev/null -m 10 "http://127.0.0.1:$PORT/login"; then echo "L'application répond sur 127.0.0.1:$PORT"; else echo "ATTENTION : pas de réponse sur le port $PORT -> pm2 logs bedolt-crm"; fi

# Sauvegarde quotidienne de la base (backups/, 30 jours)
CRON="30 3 * * * cd $APP_DIR && $(command -v node) scripts/backup.mjs >> backups/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -vF "scripts/backup.mjs" ; echo "$CRON" ) | crontab -

say "7/7 Reverse proxy + HTTPS"
if [ "$PROXY" -eq 0 ]; then
  echo "Proxy ignoré (--no-proxy). Pointe ton panel / serveur web vers http://127.0.0.1:$PORT pour $DOMAIN, avec HTTPS."
  echo "Pour le chat IA : désactive le buffering de réponse et autorise des requêtes longues (300 s)."
else
  # On n'installe Nginx que si le port 80 est libre ou déjà tenu par Nginx : jamais par-dessus un autre serveur web.
  HOLDER="$(ss -ltnp 2>/dev/null | awk '$4 ~ /:80$/ {print $NF}' | head -1 || true)"
  if [ -n "$HOLDER" ] && ! echo "$HOLDER" | grep -q nginx; then
    echo "Le port 80 est déjà utilisé par : $HOLDER"
    echo "Je ne touche pas à ce serveur web. Relance avec --no-proxy et configure le proxy dans ton panel (voir README)."
  else
    apt-get install -y -qq nginx certbot python3-certbot-nginx >/dev/null
    cat > "/etc/nginx/sites-available/$DOMAIN" <<NGINX
server {
  listen 80;
  server_name $DOMAIN;
  client_max_body_size 20m;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
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
      certbot "${CB[@]}" || echo "Certbot a échoué (DNS pas encore propagé ?). Relance plus tard : certbot --nginx -d $DOMAIN"
    else
      echo "Le DNS de $DOMAIN ne résout pas encore. Crée l'enregistrement A puis lance : certbot --nginx -d $DOMAIN"
    fi
  fi
fi

say "Terminé"
echo "CRM : https://$DOMAIN   (mot de passe dans $APP_DIR/.env)"
echo "Logs : pm2 logs bedolt-crm   ·   Mise à jour : sudo bash $APP_DIR/scripts/deploy.sh"
