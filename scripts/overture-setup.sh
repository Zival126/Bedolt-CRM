#!/usr/bin/env bash
# Prépare le moteur DuckDB de la synchronisation Overture (appelé par deploy.sh et scripts/overture-sync.sh).
#   1. Module Python épinglé dans .venv-overture (pip install duckdb==$DUCKDB_VERSION) — Python ≥ 3.10.
#   2. Repli si pip échoue : binaire CLI officiel DuckDB linux-amd64 (GitHub, release v$DUCKDB_VERSION) dans data/duckdb/,
#      empreinte SHA-256 vérifiée avant installation.
# Dernière ligne affichée : « DUCKDB OK <version> (python|cli) » ou « DUCKDB ERREUR : <raison exacte> » (code de sortie 1).
# DUCKDB_VERSION : dernière 1.5.x stable disponible sur PyPI pour Python 3.10 (Ubuntu 22.04). Les 2.x exigent un Python récent.
set -uo pipefail
umask 077
cd "$(dirname "$0")/.."

DUCKDB_VERSION="1.5.6"
# SHA-256 de duckdb_cli-linux-amd64.zip (release v1.5.6). À recouper avec l'empreinte affichée sur
# https://github.com/duckdb/duckdb/releases/tag/v1.5.6 (« sha256: » à côté du fichier) si tu changes de version.
CLI_SHA256="6e89deac1ebbc36eed0291caf8b567b030c7b86ac35998f71854e22b3c5d5e2f"
CLI_URL="https://github.com/duckdb/duckdb/releases/download/v${DUCKDB_VERSION}/duckdb_cli-linux-amd64.zip"
VENV=".venv-overture"
CLI_DIR="data/duckdb"
LOG="logs/duckdb-install.log"
mkdir -p logs "$CLI_DIR"
: > "$LOG"

py_version() { "$VENV/bin/python" -c 'import duckdb; print(duckdb.__version__)' 2>/dev/null; }
cli_version() { "$CLI_DIR/duckdb" -version 2>/dev/null | awk '{print $1}' | sed 's/^v//'; }

# 1. Module Python
if [ "$(py_version)" = "$DUCKDB_VERSION" ]; then echo "DUCKDB OK $DUCKDB_VERSION (python, $VENV)"; exit 0; fi
if [ "$(cli_version)" = "$DUCKDB_VERSION" ] && [ "${DUCKDB_FORCE_PIP:-}" != "1" ]; then echo "DUCKDB OK $DUCKDB_VERSION (cli, $CLI_DIR/duckdb)"; exit 0; fi
PYERR=""
# venv à moitié créé (sans pip, ex. python3-venv absent lors d'un essai précédent) : recréé
if [ -d "$VENV" ] && [ ! -x "$VENV/bin/pip" ]; then rm -rf "$VENV"; fi
if ! command -v python3 >/dev/null; then PYERR="python3 absent"
elif [ ! -x "$VENV/bin/python" ] && ! python3 -m venv "$VENV" >>"$LOG" 2>&1; then PYERR="python3 -m venv a échoué (paquet python3-venv manquant : apt-get install -y python3-venv) : $(grep -v '^\s*$' "$LOG" | tail -n 1)"; rm -rf "$VENV"
elif ! "$VENV/bin/pip" install --quiet --disable-pip-version-check "duckdb==${DUCKDB_VERSION}" >>"$LOG" 2>&1; then PYERR="pip install duckdb==${DUCKDB_VERSION} a échoué : $({ grep -E 'ERROR|error' "$LOG" || tail -n 2 "$LOG"; } | tail -n 2 | tr '\n' ' ')"
fi
if [ -z "$PYERR" ] && [ "$(py_version)" = "$DUCKDB_VERSION" ]; then echo "DUCKDB OK $DUCKDB_VERSION (python, $VENV)"; exit 0; fi
echo "Module Python DuckDB indisponible : ${PYERR:-version inattendue $(py_version)}. Repli : binaire CLI officiel." >&2

# 2. Binaire CLI officiel (linux-amd64)
if [ "$(uname -m)" != "x86_64" ]; then echo "DUCKDB ERREUR : $PYERR ; repli CLI impossible (architecture $(uname -m), binaire prévu pour x86_64)."; exit 1; fi
TMP="$CLI_DIR/.duckdb_cli.zip"
if command -v curl >/dev/null; then DL=(curl -fsSL --retry 3 --max-time 300 -o "$TMP" "$CLI_URL")
else DL=(python3 -c 'import sys,urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])' "$CLI_URL" "$TMP"); fi
if ! "${DL[@]}" >>"$LOG" 2>&1; then echo "DUCKDB ERREUR : $PYERR ; téléchargement du binaire CLI impossible ($CLI_URL) : $(tail -n 1 "$LOG")"; rm -f "$TMP"; exit 1; fi
GOT="$(sha256sum "$TMP" | awk '{print $1}')"
if [ "$GOT" != "$CLI_SHA256" ]; then echo "DUCKDB ERREUR : empreinte SHA-256 inattendue du binaire CLI ($GOT, attendu $CLI_SHA256) : fichier supprimé, rien n'est installé."; rm -f "$TMP"; exit 1; fi
if ! python3 -c 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.namelist()==["duckdb"], z.namelist(); z.extract("duckdb", sys.argv[2])' "$TMP" "$CLI_DIR" >>"$LOG" 2>&1; then
  echo "DUCKDB ERREUR : archive du binaire CLI illisible : $(tail -n 1 "$LOG")"; rm -f "$TMP"; exit 1; fi
rm -f "$TMP"; chmod 700 "$CLI_DIR/duckdb"
if [ "$(cli_version)" = "$DUCKDB_VERSION" ]; then echo "DUCKDB OK $DUCKDB_VERSION (cli, $CLI_DIR/duckdb, sha256 vérifié)"; exit 0; fi
echo "DUCKDB ERREUR : le binaire CLI ne démarre pas : $("$CLI_DIR/duckdb" -version 2>&1 | head -n 1)"; exit 1
