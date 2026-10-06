# Déploiement

Fleight Board se déploie avec Docker : **une image** (l'API sert aussi l'interface web) et **PostgreSQL**. Le fichier `docker-compose.yml` à la racine du dépôt décrit cette stack.

- [Prérequis](#prérequis)
- [Installation avec Docker Compose](#installation-avec-docker-compose)
- [Installation avec Portainer](#installation-avec-portainer)
- [HTTPS et reverse proxy](#https-et-reverse-proxy)
- [Configuration](#configuration)
- [Logs et supervision](#logs-et-supervision)
- [Sauvegarde et restauration](#sauvegarde-et-restauration)
- [Mise à jour](#mise-à-jour)
- [Dépannage](#dépannage)

## Prérequis

- Docker 24 ou plus, avec le plugin Compose (`docker compose version`).
- Une machine **x86-64 (amd64)**, avec 1 Go de RAM disponible pour une petite équipe.
- Un port libre sur l'hôte (8080 par défaut).

## Installation avec Docker Compose

```bash
git clone https://github.com/joblinours/fleight-board.git
cd fleight-board
cp .env.example .env
```

Dans `.env`, renseigner au minimum :

| Variable | Rôle |
|---|---|
| `POSTGRES_PASSWORD` | Mot de passe de la base, en lettres et chiffres uniquement : `openssl rand -hex 24` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Premier Admin, créé au premier démarrage (mot de passe de 10 caractères minimum) |

Puis :

```bash
docker compose up -d
docker compose ps        # « healthy » au bout de quelques secondes
```

L'application répond sur `http://<serveur>:8080`. Se connecter avec le compte Admin, puis changer son mot de passe depuis **Mon compte**. `ADMIN_PASSWORD` peut ensuite être retiré du `.env` : l'Admin n'est créé que s'il n'en existe aucun.

> **Image** : `docker compose up` récupère l'image publiée `ghcr.io/joblinours/fleight-board`. Si elle est inaccessible (registre privé, machine hors ligne), Compose la construit depuis le dépôt ; `docker compose build` force cette construction.

Au démarrage, l'application :

1. applique les **migrations** de la base (sans effet si elle est à jour) ;
2. crée le premier Admin si besoin ;
3. sert l'interface, l'API (sous `/api`) et le WebSocket (`/ws`) sur le même port.

## Installation avec Portainer

### Depuis le dépôt Git (recommandé)

1. **Stacks → Add stack**, nommer la stack (par exemple `fleight-board`).
2. Choisir **Repository** :
   - Repository URL : `https://github.com/joblinours/fleight-board`
   - Repository reference : `refs/heads/main` (version stable) ou `refs/heads/dev`
   - Compose path : `docker-compose.yml`
3. Sous **Environment variables**, ajouter au moins `POSTGRES_PASSWORD`, `ADMIN_USERNAME` et `ADMIN_PASSWORD`. Les autres variables de `.env.example` sont facultatives.
4. **Deploy the stack**.

Pour les mises à jour, activer **GitOps updates** (polling) ou utiliser **Pull and redeploy** (voir [Mise à jour](#mise-à-jour)).

### Depuis l'éditeur web

1. **Stacks → Add stack → Web editor**.
2. Coller le contenu de `docker-compose.yml` en **supprimant la ligne `build: .`**. Sans le dépôt, Portainer ne peut que télécharger l'image.
3. Ajouter les variables d'environnement comme ci-dessus, puis déployer.

Si l'image `ghcr.io/joblinours/fleight-board` est privée, l'enregistrer dans **Registries** : GitHub Container Registry, avec un token GitHub ayant le droit `read:packages`.

## HTTPS et reverse proxy

En production, placer Fleight Board derrière un reverse proxy HTTPS (Traefik, Caddy, Nginx Proxy Manager, Nginx…) et mettre **`TRUST_PROXY=true`**. L'application lit alors le protocole et l'IP réelle dans `X-Forwarded-*` : cookies `Secure`, limitation des tentatives par IP, audit.

Le proxy doit transmettre les **WebSockets** sur `/ws`. Exemples :

```caddyfile
# Caddy : HTTPS automatique, WebSockets transmis sans configuration
board.example.com {
  reverse_proxy localhost:8080
}
```

```nginx
# Nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 1h;
  client_max_body_size 12m;   # au moins MAX_UPLOAD_MB
}
```

Dans Nginx Proxy Manager, cocher **Websockets Support** sur l'hôte.

Le proxy doit conserver l'en-tête `Host` : l'application refuse les requêtes qui modifient des données si leur origine diffère de l'hôte demandé (protection CSRF).

Sans HTTPS (réseau local), l'application fonctionne aussi, par exemple sur iPad : `http://<ip-du-serveur>:8080`.

## Configuration

Variables lues par `docker-compose.yml` (fichier `.env` ou variables de la stack Portainer) :

| Variable | Défaut | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | — (obligatoire) | Mot de passe de la base (lettres et chiffres) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_EMAIL` | — | Premier Admin, créé s'il n'existe aucun Admin actif |
| `FLEIGHT_PORT` | `8080` | Port publié sur l'hôte |
| `TRUST_PROXY` | `false` | `true` derrière un reverse proxy |
| `ALLOW_REGISTRATION` | `true` | Demandes de création de compte depuis la page de connexion (validées par un Admin) |
| `MAX_UPLOAD_MB` | `10` | Taille maximale d'une image importée |
| `SESSION_TTL_DAYS`, `SESSION_IDLE_DAYS` | `30`, `7` | Durée de vie maximale d'une session, et après inactivité |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `FLEIGHT_IMAGE` | `ghcr.io/joblinours/fleight-board:latest` | Image à déployer ; une version précise : `…:0.1.0` |
| `POSTGRES_USER`, `POSTGRES_DB` | `fleight` | Utilisateur et base PostgreSQL |

Données persistantes (volumes Docker) :

| Volume | Contenu |
|---|---|
| `postgres-data` | Base PostgreSQL : comptes, boards, historique, audit |
| `fleight-data` | Fichiers importés (images), sous `/data` dans le conteneur |

## Logs et supervision

Les logs sont en **JSON**, une ligne par événement : démarrage, requêtes HTTP, sessions de collaboration et erreurs. On peut les lire tels quels ou les envoyer à Loki, Graylog ou Elastic.

```bash
docker compose logs -f app
docker compose logs app | grep '"level":50'      # erreurs uniquement
```

Exemple de ligne :

```json
{"level":30,"time":"2026-10-06T07:03:27.845Z","service":"fleight-api","username":"admin","msg":"premier Admin créé"}
```

Sondes HTTP :

| Route | Rôle |
|---|---|
| `GET /health` | Le processus répond (liveness) |
| `GET /ready` | L'application et PostgreSQL répondent (readiness, `503` sinon) |

Le `HEALTHCHECK` de l'image interroge `/ready` toutes les 15 s, et Portainer affiche cet état. Ces sondes ne sont pas journalisées.

## Sauvegarde et restauration

Une sauvegarde complète contient **la base** et **les fichiers importés**. Les scripts du dépôt font les deux sans arrêter le service :

```bash
./scripts/backup.sh /chemin/des/sauvegardes
# → fleight-db-AAAAMMJJ-HHMMSS.dump et fleight-data-AAAAMMJJ-HHMMSS.tar.gz
```

Si la stack ne s'appelle pas `fleight-board` (nom de la stack Portainer, ou dossier du `docker-compose.yml`), préciser son nom :

```bash
FLEIGHT_PROJECT=ma-stack ./scripts/backup.sh /chemin/des/sauvegardes
```

Pour une sauvegarde quotidienne, une ligne de `crontab -e` sur l'hôte :

```cron
30 3 * * * cd /opt/fleight-board && ./scripts/backup.sh /srv/backups/fleight >> /var/log/fleight-backup.log 2>&1
```

Penser à copier les sauvegardes hors du serveur et à supprimer les plus anciennes.

**Restauration** : elle remplace la base et les fichiers actuels. L'application est arrêtée pendant l'opération.

```bash
./scripts/restore.sh fleight-db-20261006-030000.dump fleight-data-20261006-030000.tar.gz
```

Sans les scripts (par exemple depuis la console d'un conteneur dans Portainer), les commandes équivalentes sont :

```bash
# Sauvegarde de la base
docker exec <conteneur-postgres> pg_dump -U fleight -d fleight -Fc > fleight-db.dump
# Sauvegarde des fichiers importés
docker run --rm --volumes-from <conteneur-app> alpine tar czf - -C /data . > fleight-data.tar.gz

# Restauration (application arrêtée)
docker stop <conteneur-app>
docker exec -i <conteneur-postgres> pg_restore -U fleight -d fleight --clean --if-exists --no-owner --single-transaction < fleight-db.dump
docker run --rm -i --volumes-from <conteneur-app> alpine sh -c 'find /data -mindepth 1 -delete && tar xzf - -C /data && chown -R 1000:1000 /data' < fleight-data.tar.gz
docker start <conteneur-app>
```

## Mise à jour

1. **Sauvegarder** (voir ci-dessus).
2. Récupérer la nouvelle version et redémarrer :

   ```bash
   git pull                 # docker-compose.yml et scripts à jour
   docker compose pull      # nouvelle image
   docker compose up -d     # migrations appliquées au démarrage
   ```

   Si l'image est construite localement : `docker compose up -d --build`.

   Dans Portainer, il y a deux cas :
   - stack Git : **Pull and redeploy**, en cochant **Re-pull image** ;
   - stack de l'éditeur web : **Update the stack**, en cochant **Re-pull image and redeploy**.

3. Vérifier que l'état est `healthy` et lire les logs de démarrage (`base de données à jour`).

Pour fixer une version, définir par exemple `FLEIGHT_IMAGE=ghcr.io/joblinours/fleight-board:0.1.0`. Les versions publiées suivent les tags `vX.Y.Z` du dépôt ; `latest` suit `main` et `dev` suit la branche de développement.

Les migrations ne sont jamais annulées automatiquement. Pour revenir à une version précédente, restaurer la sauvegarde faite avant la mise à jour, avec l'image de cette version.

## Dépannage

| Symptôme | Piste |
|---|---|
| `POSTGRES_PASSWORD manquant` au lancement | Variable absente du `.env` ou de la stack Portainer |
| Le conteneur `app` redémarre en boucle, log `Impossible d'initialiser PostgreSQL` | Mot de passe changé après la création du volume `postgres-data` : la base garde le mot de passe de sa création. Remettre l'ancien, ou le changer dans PostgreSQL (`ALTER USER fleight PASSWORD '…'`) |
| `Configuration invalide` dans les logs | Une variable a une valeur refusée (le message indique laquelle) |
| La connexion fonctionne mais le board reste « Connexion… » | Le reverse proxy ne transmet pas les WebSockets sur `/ws` |
| `Origine refusée` (403) | Le proxy réécrit l'en-tête `Host` : le conserver (`proxy_set_header Host $host`) |
| Import d'image refusé (413) | Augmenter `MAX_UPLOAD_MB`, et la limite du proxy (`client_max_body_size`) |
| Toutes les connexions ont l'IP du proxy (audit, limitation des tentatives commune à tous) | `TRUST_PROXY=true` manquant derrière le proxy |
