# syntax=docker/dockerfile:1
# Image de production de Fleight Board : l'API sert aussi le frontend.
#   docker build -t fleight-board .
# Voir docs/deployment.md (docker-compose.yml, Portainer, sauvegardes).

ARG NODE_IMAGE=node:22-alpine

# ---------------------------------------------------------------- construction
FROM ${NODE_IMAGE} AS build
WORKDIR /src
RUN corepack enable

# Dépendances d'abord : cette couche reste en cache tant que les manifestes ne changent pas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/canvas/package.json packages/canvas/
COPY packages/collaboration/package.json packages/collaboration/
COPY packages/document/package.json packages/document/
COPY packages/permissions/package.json packages/permissions/
COPY packages/protocol/package.json packages/protocol/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm --filter @fleight/web build && pnpm --filter @fleight/api build

# Contenu de l'image finale : bundle de l'API, migrations, frontend, et Argon2
# (module natif : seul paquet installé, avec le binaire de la plateforme).
RUN mkdir -p /out/node_modules/@node-rs \
  && cp -r apps/api/dist apps/api/drizzle /out/ \
  && cp -r apps/web/dist /out/web \
  && cp -rL "$(readlink -f apps/api/node_modules/@node-rs/argon2)/../." /out/node_modules/@node-rs/ \
  && printf '{"name":"fleight-board","private":true,"type":"module"}\n' > /out/package.json

# ---------------------------------------------------------------- exécution
FROM ${NODE_IMAGE}
ARG VERSION=dev
LABEL org.opencontainers.image.title="Fleight Board" \
  org.opencontainers.image.description="Whiteboard collaboratif auto-hébergé" \
  org.opencontainers.image.source="https://github.com/joblinours/fleight-board" \
  org.opencontainers.image.version="${VERSION}"

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  DATA_DIR=/data \
  WEB_DIR=/app/web

WORKDIR /app
COPY --from=build /out ./
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
VOLUME ["/data"]

# Prêt = l'API répond et PostgreSQL est joignable.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/server.js"]
