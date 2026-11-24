#!/usr/bin/env bash
# Synchronisation mensuelle Overture Maps Places (bbox Quintana Roo) → table overture_places.
# Usage (sur le VPS, sous l'utilisateur du CRM) :
#   runuser -u bedoltcrm -- bash /var/www/bedolt-crm/scripts/overture-sync.sh
# Première exécution : crée .venv-overture (python3-venv requis : apt-get install -y python3-venv) et installe DuckDB
# (~80 Mo sur disque). Chaque synchronisation : ~50-60 Mo de téléchargement temporaire, 1 à 5 minutes, ~40 Mo en base.
set -euo pipefail
cd "$(dirname "$0")/.."
DUCKDB_VERSION="2.0.1"
if [ ! -x .venv-overture/bin/python ]; then
  python3 -m venv .venv-overture
  .venv-overture/bin/pip install --quiet --disable-pip-version-check "duckdb==${DUCKDB_VERSION}"
fi
DB="$(grep -E '^DATABASE_PATH=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
exec .venv-overture/bin/python scripts/overture_sync.py --db "${DB:-data/crm.db}" "$@"
