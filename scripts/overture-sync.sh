#!/usr/bin/env bash
# Synchronisation mensuelle Overture Maps Places (bbox Quintana Roo) → table overture_places.
# Usage (sur le VPS, sous l'utilisateur du CRM) :
#   runuser -u bedoltcrm -- bash /var/www/bedolt-crm/scripts/overture-sync.sh
# Moteur : DuckDB 1.5.x, module Python (.venv-overture, ~80 Mo) ou, en repli, binaire CLI officiel (data/duckdb/,
# SHA-256 vérifié) — voir scripts/overture-setup.sh. Chaque synchronisation : ~60 Mo de téléchargement temporaire,
# 1 à 5 minutes, ~40 Mo en base.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
STATUS="$(bash scripts/overture-setup.sh | tail -n 1 || true)"
echo "$STATUS"
case "$STATUS" in
  "DUCKDB OK "*"(python"*) PY=".venv-overture/bin/python"; ENGINE=() ;;
  "DUCKDB OK "*"(cli"*) PY="python3"; ENGINE=(--duckdb-cli "$(pwd)/data/duckdb/duckdb") ;;
  *) echo "Synchronisation Overture impossible : moteur DuckDB indisponible (détails : logs/duckdb-install.log)." >&2; exit 1 ;;
esac
DB="$(grep -E '^DATABASE_PATH=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
exec "$PY" scripts/overture_sync.py --db "${DB:-data/crm.db}" "${ENGINE[@]}" "$@"
