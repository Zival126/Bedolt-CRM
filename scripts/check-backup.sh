#!/usr/bin/env bash
# Vérifie que la dernière sauvegarde QUOTIDIENNE (backups/crm-AAAA-MM-JJ.db) a moins de 26 h et qu'elle est lisible.
#   bash scripts/check-backup.sh            → code 0 si OK, 1 si trop ancienne / illisible, 2 si aucune sauvegarde
#   MAX_AGE_HOURS=30 bash scripts/check-backup.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${BACKUP_DIR:-$ROOT/backups}"
MAX_H="${MAX_AGE_HOURS:-26}"

latest="$(find "$DIR" -maxdepth 1 -type f -regextype posix-extended -regex '.*/crm-[0-9]{4}-[0-9]{2}-[0-9]{2}\.db' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)"
if [ -z "$latest" ]; then echo "ALERTE : aucune sauvegarde quotidienne dans $DIR"; exit 2; fi

age_min=$(( ( $(date +%s) - $(stat -c %Y "$latest") ) / 60 ))
human="$((age_min / 60)) h $((age_min % 60)) min"
size="$(du -h "$latest" | cut -f1)"

# Contrôle d'intégrité rapide (better-sqlite3 est dans node_modules du CRM)
integrity="$(cd "$ROOT" && node -e '
  const D=require("better-sqlite3"); const d=new D(process.argv[1],{readonly:true,fileMustExist:true});
  console.log(d.pragma("quick_check",{simple:true})); d.close();' "$latest" 2>&1 || true)"

if [ "$age_min" -gt $((MAX_H * 60)) ]; then
  echo "ALERTE : dernière sauvegarde trop ancienne ($human > ${MAX_H} h) : $latest"; exit 1
fi
if [ "$integrity" != "ok" ]; then
  echo "ALERTE : sauvegarde illisible ($integrity) : $latest"; exit 1
fi
echo "OK : dernière sauvegarde il y a $human ($size, intégrité ok) : $latest"
