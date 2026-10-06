#!/usr/bin/env bash
# Sauvegarde d'un déploiement Docker de Fleight Board : base PostgreSQL (pg_dump,
# format custom) et fichiers importés (volume /data), sans arrêter le service.
#
# Usage : ./scripts/backup.sh [répertoire]            (défaut : ./backups)
#         FLEIGHT_PROJECT=ma-stack ./scripts/backup.sh  nom de la stack (défaut : fleight-board)
set -euo pipefail

PROJECT=${FLEIGHT_PROJECT:-fleight-board}
DEST=${1:-./backups}
STAMP=$(date +%Y%m%d-%H%M%S)

container() {
  docker ps -q --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$1" | head -n1
}

POSTGRES=$(container postgres)
APP=$(container app)
[ -n "$POSTGRES" ] || { echo "Service postgres de la stack « $PROJECT » introuvable (FLEIGHT_PROJECT ?)" >&2; exit 1; }
[ -n "$APP" ] || { echo "Service app de la stack « $PROJECT » introuvable (FLEIGHT_PROJECT ?)" >&2; exit 1; }

mkdir -p "$DEST"
DB_FILE="$DEST/fleight-db-$STAMP.dump"
DATA_FILE="$DEST/fleight-data-$STAMP.tar.gz"

echo "→ Base de données : $DB_FILE"
docker exec "$POSTGRES" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$DB_FILE"

echo "→ Fichiers importés : $DATA_FILE"
docker run --rm --volumes-from "$APP" alpine tar czf - -C /data . >"$DATA_FILE"

echo "Sauvegarde terminée."
