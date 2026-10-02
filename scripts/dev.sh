#!/usr/bin/env bash
# Lance l'environnement de développement complet :
# dépendances, PostgreSQL (port libre trouvé automatiquement), configuration de l'API,
# puis l'API et le frontend.
#
# Usage : ./scripts/dev.sh            (ou : pnpm dev:all)
#         POSTGRES_PORT=55432 ./scripts/dev.sh   pour imposer le port de la base
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE=infrastructure/compose/docker-compose.dev.yml
CONTAINER=fleight-board-dev-postgres-1
ENV_FILE=apps/api/.env
API_PORT=3000
WEB_PORT=5173

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  \033[36m→\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

bold "Fleight Board — environnement de développement"

# --- Outils -------------------------------------------------------------------
command -v node >/dev/null || fail "Node.js est introuvable (version 22 ou plus requise)."
command -v pnpm >/dev/null || fail "pnpm est introuvable : npm install -g pnpm@10"
command -v docker >/dev/null || fail "Docker est introuvable (nécessaire pour PostgreSQL)."
docker info >/dev/null 2>&1 || fail "Le démon Docker ne répond pas (sudo systemctl start docker ?)."

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  warn "Node $(node -v) détecté : le projet demande Node 22 ou plus (ça fonctionne, mais à mettre à jour)."
fi

# --- Dépendances --------------------------------------------------------------
if [ ! -f node_modules/.modules.yaml ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ]; then
  info "Installation des dépendances…"
  pnpm install --silent
else
  info "Dépendances à jour."
fi

# --- PostgreSQL ---------------------------------------------------------------
container_port() { docker port "$CONTAINER" 5432/tcp 2>/dev/null | head -n1 | sed 's/.*://'; }

pick_port() {
  if [ -n "${POSTGRES_PORT:-}" ]; then
    echo "$POSTGRES_PORT"
    return
  fi
  for candidate in 5432 55432 55433 55434 55435; do
    if ! port_in_use "$candidate"; then
      echo "$candidate"
      return
    fi
  done
  fail "Aucun port libre trouvé pour PostgreSQL (essayer POSTGRES_PORT=…)."
}

start_database() {
  local port=$1
  info "Démarrage de PostgreSQL sur le port $port…"
  POSTGRES_PORT=$port docker compose -f "$COMPOSE_FILE" up -d --force-recreate >/dev/null
}

STATE=$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo absent)
if [ "$STATE" = running ]; then
  DB_PORT=$(container_port)
  info "PostgreSQL déjà démarré (port $DB_PORT)."
else
  if [ "$STATE" != absent ] && docker start "$CONTAINER" >/dev/null 2>&1; then
    DB_PORT=$(container_port)
    info "PostgreSQL redémarré (port $DB_PORT)."
  else
    # Conteneur absent, ou son ancien port est désormais pris : on le recrée
    # sur un port libre (les données sont dans un volume, rien n'est perdu).
    start_database "$(pick_port)"
    DB_PORT=$(container_port)
  fi
fi

printf '  → Attente de PostgreSQL'
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U fleight -d fleight >/dev/null 2>&1; then break; fi
  printf '.'
  sleep 1
done
echo
docker exec "$CONTAINER" pg_isready -U fleight -d fleight >/dev/null 2>&1 ||
  fail "PostgreSQL ne répond pas (docker logs $CONTAINER)."

# --- Configuration de l'API ---------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  cp apps/api/.env.example "$ENV_FILE"
  info "Configuration créée : $ENV_FILE"
fi
EXPECTED_URL="postgres://fleight:fleight@localhost:${DB_PORT}/fleight"
CURRENT_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- || true)
if [ "$CURRENT_URL" != "$EXPECTED_URL" ]; then
  if grep -qE '^DATABASE_URL=' "$ENV_FILE"; then
    sed -i.bak -E "s#^DATABASE_URL=.*#DATABASE_URL=${EXPECTED_URL}#" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    echo "DATABASE_URL=${EXPECTED_URL}" >>"$ENV_FILE"
  fi
  info "DATABASE_URL aligné sur la base du projet (port $DB_PORT)."
fi
# Premier Admin de développement : créé au démarrage de l'API s'il n'existe aucun Admin.
if ! grep -qE '^ADMIN_USERNAME=' "$ENV_FILE"; then
  ADMIN_PASSWORD=$(node -e "process.stdout.write(require('node:crypto').randomBytes(12).toString('base64url'))")
  printf '\n# Premier Admin (développement)\nADMIN_USERNAME=admin\nADMIN_PASSWORD=%s\n' "$ADMIN_PASSWORD" >>"$ENV_FILE"
  info "Admin de développement ajouté à $ENV_FILE."
fi
ADMIN_USER=$(grep -E '^ADMIN_USERNAME=' "$ENV_FILE" | cut -d= -f2-)
ADMIN_PASS=$(grep -E '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)

# --- Ports de l'API et du frontend ----------------------------------------------
if port_in_use "$API_PORT"; then
  fail "Le port $API_PORT (API) est déjà utilisé — un ancien « pnpm dev » tourne-t-il encore ? (pkill -f 'src/server.ts')"
fi
if port_in_use "$WEB_PORT"; then
  warn "Le port $WEB_PORT est déjà utilisé : Vite prendra le suivant (voir l'adresse affichée plus bas)."
fi

# --- Lancement ----------------------------------------------------------------
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
echo
bold "Prêt. Ouvrir :"
echo "  PC   : http://localhost:${WEB_PORT}"
[ -n "$LAN_IP" ] && echo "  iPad : http://${LAN_IP}:${WEB_PORT}   (même réseau Wi-Fi)"
echo "  Arrêt : Ctrl+C (la base reste démarrée ; pnpm db:down pour l'arrêter)"
echo

export TURBO_TELEMETRY_DISABLED=1
exec pnpm dev
