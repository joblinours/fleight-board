#!/usr/bin/env bash
# Restauration d'une sauvegarde faite par scripts/backup.sh. REMPLACE les données
# actuelles : base et fichiers importés. L'application est arrêtée pendant l'opération.
#
# Usage : ./scripts/restore.sh <fleight-db-….dump> <fleight-data-….tar.gz>
#         FLEIGHT_PROJECT=ma-stack ./scripts/restore.sh …   nom de la stack (défaut : fleight-board)
set -euo pipefail

PROJECT=${FLEIGHT_PROJECT:-fleight-board}
DB_FILE=${1:?Usage : restore.sh <base.dump> <fichiers.tar.gz>}
DATA_FILE=${2:?Usage : restore.sh <base.dump> <fichiers.tar.gz>}
[ -f "$DB_FILE" ] || { echo "Fichier introuvable : $DB_FILE" >&2; exit 1; }
[ -f "$DATA_FILE" ] || { echo "Fichier introuvable : $DATA_FILE" >&2; exit 1; }

container() {
  docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$1" | head -n1
}

POSTGRES=$(container postgres)
APP=$(container app)
[ -n "$POSTGRES" ] && [ -n "$APP" ] || { echo "Stack « $PROJECT » introuvable (FLEIGHT_PROJECT ?)" >&2; exit 1; }

if [ "${FLEIGHT_RESTORE_YES:-}" != 1 ]; then
  read -r -p "Les données actuelles de « $PROJECT » seront remplacées. Continuer ? [o/N] " answer
  case "$answer" in o|O|oui|y|Y|yes) ;; *) echo "Annulé."; exit 1 ;; esac
fi

echo "→ Arrêt de l'application"
docker stop "$APP" >/dev/null

echo "→ Base de données"
docker exec -i "$POSTGRES" sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction' <"$DB_FILE"

echo "→ Fichiers importés"
docker run --rm -i --volumes-from "$APP" alpine \
  sh -c 'find /data -mindepth 1 -delete && tar xzf - -C /data && chown -R 1000:1000 /data' <"$DATA_FILE"

echo "→ Redémarrage de l'application"
docker start "$APP" >/dev/null
echo "Restauration terminée."
