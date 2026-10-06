# Fleight Board

> Whiteboard collaboratif temps réel, self-hosted, Docker-first, extensible par plugins et conçu dès le départ pour desktop, tablette et Apple Pencil.

![Statut](https://img.shields.io/badge/statut-d%C3%A9veloppement-orange)
![Phase](https://img.shields.io/badge/phase-1%20%E2%80%94%20Core%20MVP-blue)
![Licence](https://img.shields.io/badge/licence-C8CL%20%2B%20commerciale-lightgrey)

> [!WARNING]
> **Projet en développement.** La preuve de concept (Phase 0) est terminée ; aucune version utilisable en production n'est encore disponible. Ce README décrit la cible du produit et sera mis à jour au fil de la réalisation. Les éléments marqués _(prévu)_ ne sont pas encore implémentés.

---

## Sommaire

- [Présentation](#présentation)
- [Fonctionnalités](#fonctionnalités)
- [Principes](#principes)
- [Architecture](#architecture)
- [Stack technique](#stack-technique)
- [Modèle de collaboration](#modèle-de-collaboration)
- [Utilisateurs, rôles et permissions](#utilisateurs-rôles-et-permissions)
- [Partage](#partage)
- [Plugins](#plugins)
- [Structure du dépôt](#structure-du-dépôt)
- [Installation](#installation)
- [Développement](#développement)
- [Roadmap](#roadmap)
- [Sécurité](#sécurité)
- [Contribuer](#contribuer)
- [Licence](#licence)

---

## Présentation

Fleight Board est une application hybride entre **Freeform**, **draw.io** et un outil de collaboration temps réel. Elle permet de :

- créer des whiteboards persistants (canvas borné ou infini) ;
- dessiner librement, y compris à l'Apple Pencil avec la pression ;
- construire des diagrammes structurés (formes, groupes, frames, connecteurs intelligents) ;
- collaborer en temps réel, avec curseurs, présence et verrouillage d'objets ;
- gérer finement les permissions et le partage (code court, liens, invités) ;
- présenter un whiteboard à une audience ;
- importer et exporter (PDF, SVG, PNG, JPG) ;
- étendre l'application par des plugins (formes réseau, cloud, formats, authentification).

Le tout est déployable en self-hosted avec une seule commande : `docker compose up -d`.

## Fonctionnalités

### Canvas et objets

| Fonctionnalité | Statut |
|---|---|
| Whiteboards : création (nom, description, format), liste, renommage, masquage, suppression | 🧪 Implémenté (M1.2) |
| Canvas standard (A4, A3, A2, 16:9, 4:3, personnalisé) | 🧪 Page de taille fixe, portrait ou paysage (M1.2) |
| Canvas infini (zoom, pan) | 🧪 Moteur de rendu prototypé (M0.2) |
| Primitives : rectangle, ellipse, ligne, flèche, polygone, texte, image | 🧪 Implémentées (M1.3) ; images PNG, JPEG, GIF, WebP importées par bouton, glisser-déposer ou collage |
| Dessin libre : stylo, surligneur, gomme, couleur, épaisseur, opacité | 🧪 Implémenté (M1.3) ; panneau de propriétés pour la sélection et les prochains objets |
| Sélection, groupes, copier/coller, duplication | 🧪 Implémenté (M1.4) : rectangle de sélection, lasso, groupes, premier/arrière-plan ; copier/coller via le presse-papiers système, donc aussi d'un board à l'autre |
| Frames (conteneurs titrés, exportables) | 🧪 Titre, fond, déplacement avec leur contenu (M1.4) ; export prévu |
| Connecteurs droits/orthogonaux, ancrages, labels, suivi des objets | 🧪 Implémenté (M1.5) : tracé orthogonal à routage simple (sans contournement d'obstacles), pointes de flèche, labels, reconnexion par glisser |
| Métadonnées structurées sur les objets | _(prévu)_ |

### Collaboration

| Fonctionnalité | Statut |
|---|---|
| Synchronisation temps réel via WebSocket | 🧪 Prototypée (M0.5), persistée dans PostgreSQL (M0.6) |
| Verrouillage temporaire des objets en cours d'édition | 🧪 Prototypé (M0.7) |
| Curseurs et présence (modes « Drawing only » / « Cursor visible ») | 🧪 Implémenté (M1.6) : curseurs nommés à la couleur du participant, liste des participants, mode choisi par chacun et mémorisé |
| Undo/redo individuel (chacun n'annule que ses propres actions) | 🧪 Prototypé (M0.8) |
| Audit log complet et non annulable | 🧪 Implémenté (M0.10, M1.9) : une entrée par opération finale (annulations comprises) et par événement de gestion ; page d'audit filtrable, paginée et exportable (CSV), audit global pour l'Admin |
| Travail local temporaire pendant une coupure réseau, puis resynchronisation | 🧪 Prototypé (M0.9) |
| Mode présentation (navigation, zoom et focus synchronisés) | _(prévu)_ |

### Administration

| Fonctionnalité | Statut |
|---|---|
| Authentification locale (Argon2id, sessions, anti brute force) | 🧪 Implémentée (M1.1) ; MFA TOTP _(prévu)_ |
| Gestion des comptes Users / Admins, demandes de compte | 🧪 Implémentée (M1.1) |
| Interface web (tableau de bord, administration, thème clair/sombre) | 🧪 Implémentée (M1.9.5) : design system maison, barre latérale, menus et modales |
| Politique de rétention (corbeille) | _(prévu)_ |
| Limites de fichiers et de stockage | _(prévu)_ |
| Gestion des plugins (ZIP, marketplace) | _(prévu)_ |
| LDAP / Active Directory / SAML / OIDC (modules officiels) | _(prévu)_ |

### Tablette et Apple Pencil

L'iPad avec Apple Pencil est une **cible de premier rang**, pas une adaptation :

- Pointer Events distinguant souris, doigt et stylet ;
- pression et événements haute fréquence ;
- palm rejection, modes Pencil-only et Touch-only ;
- zoom et pan multi-touch ;
- rendu local immédiat, indépendant de la qualité réseau ;
- interface tactile (M1.11) :
  - barre d'outils compacte, où chaque famille d'outils se déplie ;
  - cibles de 44 px ;
  - panneau de propriétés repliable, et mode « interface masquée » ;
  - disposition portrait et paysage ;
- clavier externe : raccourcis avec ⌘, flèches pour déplacer, zoom au clavier, `?` pour l'aide.

## Principes

- **Docker-first** : `docker compose up -d`, compatible Portainer, configuration par variables d'environnement, volumes persistants, healthchecks.
- **Online-first** : conçu pour fonctionner en ligne ; une coupure temporaire est absorbée par une file d'opérations locale, sans mode hors ligne complet.
- **Tablet-first pour le dessin** : la fluidité au stylet guide les choix de rendu.
- **Serveur autoritaire** : chaque opération est validée côté serveur. On ne fait jamais confiance au client.
- **Le cœur d'abord** : un canvas extrêmement fluide, un modèle d'objets solide et une synchronisation fiable passent avant le marketplace et les fonctions enterprise.

## Architecture

```text
                         Internet
                            |
                    Reverse Proxy / TLS
                            |
                  +--------------------+
                  |    Web Frontend    |
                  +---------+----------+
                            | HTTPS / WSS
                  +---------+----------+
                  |      API / WS      |
                  +---------+----------+
                            |
              +-------------+-------------+
              |             |             |
        Collaboration      Auth      Plugin Runtime
           Engine
              |
       +------+------+
       |             |
   PostgreSQL   Object Storage
                (volume Docker → S3 plus tard)
```

**Première version** : 1 frontend, 1 backend, PostgreSQL, stockage de fichiers sur volume Docker. Redis n'est pas requis en v1 : la diffusion des messages passe par une abstraction pub/sub en mémoire, remplaçable par Redis quand plusieurs instances backend seront activées.

**Cible de scalabilité** : plusieurs instances API derrière un load balancer, Redis pour le pub/sub, PostgreSQL, stockage compatible S3 (MinIO, etc.).

## Stack technique

| Domaine | Choix |
|---|---|
| Langage | TypeScript (frontend et backend) |
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | React + Vite |
| Rendu du canvas | Moteur maison en Canvas 2D (culling, cache par objet) |
| Traits à main levée | `perfect-freehand` (MIT) |
| Backend | Node.js + Fastify |
| Temps réel | WebSocket (`ws`), protocole versionné |
| Validation / protocole | Schémas `zod` partagés client/serveur |
| Base de données | PostgreSQL + Drizzle ORM |
| Mots de passe | Argon2id |
| MFA | TOTP (`otplib`), compatible Google Authenticator, Aegis, 2FAS… |
| Déploiement | Docker Compose |

> Toutes les dépendances doivent être sous licence permissive (MIT, Apache-2.0, BSD, ISC) afin de rester compatibles avec la double licence du projet.

## Modèle de collaboration

Fleight Board utilise une approche **hybride à serveur autoritaire** :

- le whiteboard est un **document structuré** (objets, groupes, frames, connecteurs), pas une image ;
- les clients envoient des **opérations structurées** (`CREATE_OBJECT`, `UPDATE_OBJECT`, `DELETE_OBJECT`, …) ;
- le serveur valide les permissions, applique, **versionne chaque objet**, journalise et diffuse ;
- un objet en cours d'édition est **verrouillé** par son éditeur (pointer down → lock, pointer up → unlock, avec un timeout de sécurité) ;
- l'état est persisté sous forme de **journal d'opérations + snapshots** ;
- chaque opération finale (un tracé ou un déplacement complet, une annulation…) produit une entrée dans **`audit_logs`**, écrite dans la même transaction que le journal.

### Règles de résolution

| Situation | Comportement |
|---|---|
| Alice déplace X, Bob change ensuite sa couleur, Alice fait Ctrl+Z | Seule la position est restaurée ; la couleur de Bob est conservée |
| Undo sur un objet supprimé entre-temps par un autre utilisateur | Undo ignoré, avec notification |
| Opérations faites pendant une coupure réseau en conflit avec des modifications distantes | Rejetées, avec notification (« N modifications n'ont pas pu être appliquées ») |
| Même propriété modifiée en même temps par deux participants | La première modification arrivée au serveur l'emporte, l'autre est refusée et signalée |
| Undo | Enregistré dans l'audit log ; l'audit log n'est jamais annulé |

## Utilisateurs, rôles et permissions

### Rôles globaux (application)

| Rôle | Description |
|---|---|
| **Admin** | Gestionnaire de l'application : comptes, MFA, authentification, rétention, limites, plugins, logs. Dispose aussi des fonctionnalités d'un User. |
| **User** | Crée, gère, partage et édite des whiteboards. |
| **Guest** | Sans compte : rejoint via un code ou un lien avec un username, selon les règles du whiteboard. Aucun droit administratif. |

### Rôles sur un whiteboard

```text
Viewer < Editor < Presenter < Co-owner < Owner
```

- Il n'existe **pas** de rôle « Admin » au niveau d'un whiteboard : le rôle Admin est réservé au gestionnaire de l'application.
- Les rôles sont cumulatifs : un Presenter peut aussi éditer.
- Seul l'**Owner** peut supprimer le whiteboard et en transférer la propriété ; le **Co-owner** gère tout le reste (membres, partage, permissions).
- On ne peut déléguer qu'un rôle au plus égal au sien.
- Un Admin global qui crée un whiteboard y agit comme un User ; le rôle maximal qu'il peut déléguer est **Co-owner**. Il n'a aucun droit implicite sur les boards des autres (seule la lecture de l'audit lui reste ouverte).
- Accès des non-membres qui connaissent le lien ou le code : voir [Partage](#partage). Un rôle de membre l'emporte toujours, même s'il est plus faible.
- Le serveur vérifie le rôle sur chaque requête REST et chaque message WebSocket ; un changement de rôle s'applique en direct aux sessions ouvertes, un membre qui perd l'accès est déconnecté.

| Action | Rôle minimal |
|---|---|
| Voir le board, les participants, partager son curseur | Viewer |
| Créer, modifier, supprimer des objets ; importer des images | Editor |
| Présenter (Phase 2) | Presenter |
| Renommer, masquer, régler l'accès ; gérer les membres ; lire l'audit | Co-owner |
| Supprimer le board, transférer la propriété | Owner |

### Accès temporaires

Un membre (ou un invité) peut recevoir un accès **permanent**, **temporaire** (1 heure à 30 jours) ou **valable tant que la personne qui l'a accordé est connectée au board**. À l'expiration (vérifiée toutes les 30 s) ou au départ de cette personne, la session est fermée.

## Partage

- **Code court** de 6 caractères (ex. `K7P4X2`), sans caractères ambigus (`O/0`, `I/1`, `S/5`). C'est un identifiant, pas un secret : rate limiting par adresse, et **cooldown** de 5 minutes après 10 codes inexistants en 10 minutes. Lien de partage : `#/join/CODE`.
- **Session publique** : toute personne connaissant le code entre directement, avec le rôle par défaut du board (Editor ou Viewer).
- **Session privée** : chaque demande d'accès doit être acceptée (rôle et durée) ou refusée par le propriétaire ou un Co-owner, prévenus en temps réel ; le demandeur attend dans une salle d'attente et entre dès l'acceptation.
- **Invités** (si le board les accepte) : sans compte, avec un simple nom, par le code ou le lien. Un invité est Viewer ou Editor, limité à ce board, pour 24 heures au plus ; il ne gère rien et n'importe pas d'images.
- **Share links** Viewer ou Editor, à jetons aléatoires longs, révocables et éventuellement temporaires.

## Plugins

Le système de plugins est central. Chaque plugin **déclare ses permissions** (lecture du canvas, création d'objets, accès réseau…) et n'a accès à rien par défaut.

| Catégorie | Exemples |
|---|---|
| Formes / canvas | Network, Cybersecurity, AWS, Azure, Kubernetes, UML |
| Import / export | draw.io, Mermaid, Visio |
| Fonctionnalités | Générateur Mermaid, outils d'architecture |
| Authentification | LDAP, Active Directory, SAML, OIDC — **modules officiels signés uniquement** |

Sources d'installation : upload ZIP et marketplace. Premier plugin prévu : **Network / Infrastructure**.

## Structure du dépôt

```text
fleight-board/
├── apps/
│   ├── web/              # Frontend React + Vite
│   └── api/              # Backend Fastify (REST + WebSocket)
├── packages/
│   ├── canvas/           # Moteur de rendu et d'entrée (caméra, rendu, Pointer Events)
│   ├── collaboration/    # Sessions (serveur), client optimiste, pub/sub
│   ├── document/         # État du board, opérations et géométrie (client et serveur)
│   ├── permissions/      # Rôles de whiteboard, matrice rôle → actions, règles de délégation
│   ├── protocol/         # Schémas zod (objets, messages) versionnés
│   └── shared/           # Utilitaires communs (identifiants ULID…)
├── infrastructure/
│   └── compose/          # docker-compose de développement
├── scripts/              # dev.sh, backup.sh, restore.sh
├── docs/                 # Plan d'implémentation, déploiement, rapports
├── Dockerfile            # Image de production (l'API sert aussi le frontend)
└── docker-compose.yml    # Déploiement : application + PostgreSQL
```

À venir : `packages/plugin-sdk`, `plugins/network`, `tests/` (collaboration et e2e).

## Installation

```bash
git clone https://github.com/joblinours/fleight-board.git
cd fleight-board
cp .env.example .env    # POSTGRES_PASSWORD et premier Admin (ADMIN_USERNAME / ADMIN_PASSWORD)
docker compose up -d
```

L'application répond sur `http://<serveur>:8080`. Une seule image (`ghcr.io/joblinours/fleight-board`) sert l'interface, l'API et le WebSocket ; les migrations de la base s'appliquent au démarrage.

Le guide [docs/deployment.md](docs/deployment.md) couvre :
- l'installation avec **Portainer** ;
- HTTPS derrière un reverse proxy ;
- les variables et les volumes ;
- les logs JSON et les healthchecks (`/health`, `/ready`) ;
- la **sauvegarde et la restauration** (`scripts/backup.sh`, `scripts/restore.sh`) ;
- la **mise à jour**.

## Développement

### Prérequis

- Node.js 22+ (voir `.nvmrc`)
- pnpm 10 (`corepack enable`)
- Docker (pour PostgreSQL)

### Démarrage rapide

```bash
./scripts/dev.sh        # ou : pnpm dev:all
```

Le script s'occupe de tout :
- il installe les dépendances si besoin ;
- il démarre PostgreSQL dans Docker, sur un port libre (5432, sinon 55432…) ;
- il crée ou aligne `apps/api/.env`, avec un Admin de développement (mot de passe généré) ;
- il lance l'API et le frontend, puis affiche les adresses PC et iPad et les identifiants de l'Admin.

La page d'accueil liste les tests de chaque jalon.

### Démarrage manuel

```bash
pnpm install
pnpm db:up                                   # PostgreSQL de développement
cp apps/api/.env.example apps/api/.env       # configuration de l'API
pnpm dev                                     # API sur :3000, web sur :5173
```

Si le port 5432 est déjà utilisé (PostgreSQL installé localement), lancez la base sur un autre port et reportez-le dans `DATABASE_URL` :

```bash
POSTGRES_PORT=5433 pnpm db:up
# apps/api/.env : DATABASE_URL=postgres://fleight:fleight@localhost:5433/fleight
```

Ouvrez http://localhost:5173 : la page d'accueil donne, pour chaque jalon, le lien de test et les étapes à suivre. Le serveur Vite écoute sur le réseau local : depuis un iPad sur le même Wi-Fi, ouvrez `http://<ip-de-votre-machine>:5173`. Il relaie `/api/*` et `/ws` vers l'API.

Pour vous connecter, définissez le premier Admin dans `apps/api/.env` (`ADMIN_USERNAME`, `ADMIN_PASSWORD`) : il est créé au démarrage de l'API s'il n'existe aucun Admin actif.

Au démarrage, l'API applique automatiquement les migrations de la base (`apps/api/drizzle`). Après une modification de `apps/api/src/db/schema.ts`, générez la migration avec `pnpm --filter @fleight/api exec drizzle-kit generate`.

Les tests d'intégration PostgreSQL ne s'exécutent que si `TEST_DATABASE_URL` est défini :

```bash
TEST_DATABASE_URL=postgres://fleight:fleight@localhost:5432/fleight pnpm test
```

### Commandes

| Commande | Rôle |
|---|---|
| `pnpm dev` | Lance l'API et le web en mode watch |
| `pnpm lint` | Lint et vérification du formatage (Biome) |
| `pnpm format` | Corrige le formatage |
| `pnpm typecheck` | Vérifie les types de tous les packages |
| `pnpm test` | Lance les tests (Vitest) |
| `pnpm build` | Build de production (frontend `apps/web/dist`, API en un fichier `apps/api/dist/server.js`) |
| `pnpm db:up` / `pnpm db:down` | Démarre / arrête PostgreSQL |
| `pnpm load` | Test de charge contre l'API lancée : utilisateurs simulés sur le vrai WebSocket, latences et convergence (`--users 2,5,20,50 --duration 30 --board <nom>`) |

### Configuration de l'API

Variables d'environnement (`apps/api/.env`, modèle : `apps/api/.env.example`) :

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | — | Base PostgreSQL |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Adresse d'écoute |
| `LOG_LEVEL` | `info` | Niveau de logs (JSON, une ligne par événement) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` | — | Premier Admin, créé au démarrage s'il n'existe aucun Admin actif |
| `ALLOW_REGISTRATION` | `true` | Demandes de compte depuis l'interface (validées par un Admin) |
| `SESSION_TTL_DAYS` / `SESSION_IDLE_DAYS` | `30` / `7` | Durée de vie maximale d'une session, et après inactivité |
| `DATA_DIR` | `./data` | Répertoire des données : fichiers importés dans `blobs/` (volume Docker en production) |
| `MAX_UPLOAD_MB` | `10` | Taille maximale d'une image importée |
| `TRUST_PROXY` | `false` | Derrière un reverse proxy HTTPS : protocole et IP lus dans `X-Forwarded-*` |
| `WEB_DIR` | — | Frontend construit à servir (`/app/web` dans l'image) ; absent en développement, où Vite le sert |

### Endpoints de l'API

| Endpoint | Rôle |
|---|---|
| `GET /health` | Liveness : le processus répond |
| `GET /ready` | Readiness : PostgreSQL est joignable (`503` sinon) |
| `POST /auth/login` | Connexion (nom d'utilisateur ou e-mail + mot de passe) ; pose le cookie de session |
| `POST /auth/logout` | Déconnexion |
| `GET /auth/me` | Utilisateur connecté |
| `POST /auth/password` | Changement de son mot de passe (ferme ses autres sessions) |
| `POST /auth/register` | Demande de compte, en attente de validation |
| `GET`, `POST /admin/users` | Admin : liste et création de comptes (mot de passe temporaire généré) |
| `PATCH`, `DELETE /admin/users/:id` | Admin : nom, e-mail, rôle, activation / validation, suppression |
| `POST /admin/users/:id/reset-password` | Admin : mot de passe temporaire, sessions fermées |
| `GET /admin/audit` | Admin : audit global (`scope=all\|accounts\|boards`, `boardId`) avec les mêmes filtres que l'audit d'un board |
| `GET`, `POST /boards` | Ses whiteboards et ceux partagés avec lui, avec son rôle (`?hidden=true` : avec les masqués) ; création (nom, description, canvas infini ou standard) |
| `GET /boards/code/:code` | Board correspondant à un code court (rate limiting par IP ; `403` si réservé à ses membres) |
| `GET`, `PATCH`, `DELETE /boards/:id` | Détails (Viewer) ; renommage, description, masquage, session publique/privée, rôle par défaut, invités (Co-owner) ; suppression immédiate (Owner) |
| `GET`, `POST /boards/:id/members` | Propriétaire et membres (tout participant) ; ajout par nom d'utilisateur ou e-mail (Co-owner, rôle au plus égal au sien) |
| `PATCH`, `DELETE /boards/:id/members/:userId` | Rôle d'un membre ; retrait (Co-owner, membre de rôle au plus égal au sien), ou départ volontaire |
| `POST /boards/:id/transfer` | Transfert de propriété à un membre (Owner ; il devient Co-owner) |
| `POST /boards/:id/access-requests` | Demande d'accès à une session privée ; `GET /boards/:id/access-request` : état de sa demande (compte ou invité) |
| `GET /boards/:id/access-requests`, `POST /boards/:id/access-requests/:requestId` | Demandes en attente ; acceptation (rôle, durée) ou refus (Co-owner) |
| `POST /boards/code/:code/guest` | Rejoindre sans compte (nom) : cookie invité limité au board (cooldown des codes) |
| `GET /guest` ; `DELETE /boards/:id/guests/:guestId` | Invité de la session et son board ; retrait d'un invité (Co-owner) |
| `POST /boards/:id/assets` | Import d'une image (Editor ; corps brut ; type vérifié dans le fichier : PNG, JPEG, GIF, WebP ; SVG refusé) |
| `GET /assets/:id` | Image importée (session requise, contenu immuable) |
| `GET /boards/:id/audit` | Audit d'un board, du plus récent au plus ancien (Co-owner, Owner, Admin). Filtres : `category` (`objects`, `board`, `access`, `accounts`), `actor`, `q` (nom, auteur ou objet), `objectId`, `from`, `to` ; pagination `limit` (≤ 500) et `before` (curseur `nextBefore`) |
| `WS /ws` | WebSocket, session requise ; le premier message doit être `HELLO` avec la version du protocole |

## Roadmap

Le plan détaillé (jalons, critères de validation, décisions) est tenu dans [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) sur la branche `dev`.

- [x] **Phase 0 — Proof of Concept technique** : canvas desktop + iPad/Apple Pencil, objets structurés, connecteurs, WebSocket, 2+ utilisateurs, locks, undo individuel, persistance, reconnexion, audit log. Terminée le 2 octobre 2026 — [rapport de fin de phase](docs/poc-report.md).
- [ ] **Phase 1 — Core MVP** : auth locale, Users/Admins, canvas standard et infini, primitives, texte, images, dessin libre, sélection, groupes, frames, connecteurs, undo/redo, collaboration temps réel, locks, curseurs, présence, sessions par code, public/privé, permissions, guests, audit log.
- [ ] **Phase 2 — Produit utilisable** : présentation, share links, import PDF/SVG/images, export SVG/PNG/PDF, rétention, limites de stockage, MFA, administration complète, transfert de propriété, reconnexion robuste, interface tablette complète.
- [ ] **Phase 3 — Système de plugins** : SDK, API, permissions, sandbox, installation ZIP, cycle de vie, marketplace, plugin Network.
- [ ] **Phase 4 — Auth enterprise** : LDAP, Active Directory, SAML, OIDC, mapping groupes → rôles.
- [ ] **Phase 5 — Scalabilité** : plusieurs backends, Redis, stockage S3, load balancer, workers.
- [ ] **Phase 6 — Écosystème** : marketplace avancé, plugins communautaires, draw.io, Mermaid, Visio.

## Sécurité

- Mots de passe hachés en Argon2id (paramètres OWASP) ; 10 caractères minimum, sans règles de composition.
- Sessions en cookie `HttpOnly` / `SameSite=Lax` (et `Secure` en HTTPS) ; seul le hash du jeton est stocké ; expiration après 7 jours d'inactivité et 30 jours au plus ; jeton renouvelé chaque jour.
- Anti brute force : compte bloqué 15 minutes après 5 échecs, tentatives de connexion limitées par adresse IP, temps de réponse identique pour un compte inconnu.
- Requêtes qui modifient l'état et connexions WebSocket refusées si elles viennent d'une autre origine.
- Désactiver un compte, le supprimer ou réinitialiser son mot de passe ferme immédiatement ses sessions et ses connexions.
- Connexions, échecs et actions d'administration tracés dans l'audit log.
- MFA TOTP optionnel, imposable globalement par l'Admin.
- Chaque message WebSocket est associé à un utilisateur, une session, un whiteboard et des permissions, et est validé côté serveur.
- Plugins isolés et limités par permissions.

Pour signaler une vulnérabilité, merci de ne pas ouvrir d'issue publique : contactez Couche 8 via [couche-8.com](https://couche-8.com).

## Contribuer

Les contributions sont les bienvenues. Lisez [CONTRIBUTING.md](CONTRIBUTING.md) avant d'ouvrir une pull request : toute contribution nécessite l'acceptation du [Contributor License Agreement](CLA.md).

Workflow git : `main` (versions stables) ← `dev` (intégration) ← `feature/*`.

## Licence

Fleight Board est distribué sous double licence par **Couche 8 ASBL** :

- **[Couche 8 Community License (C8CL)](LICENSE.md)** : usage **gratuit** pour l'usage personnel, l'enseignement et la recherche académique, et les associations éligibles à but non lucratif.
- **[Licence commerciale](COMMERCIAL-LICENSE.md)** : **obligatoire** pour toute utilisation par une organisation commerciale, y compris en self-hosted.

| Taille de l'organisation | Tarif annuel |
|---|---:|
| 1–50 employés | 7 € / employé |
| 51–150 employés | 9 € / employé |
| 151–250 employés | 12 € / employé |
| Plus de 250 employés | 4 000 € / an, utilisateurs illimités |

Détails dans [PRICING.md](PRICING.md). Ce logiciel est _source-available_ ; il n'est pas « open source » au sens de l'OSI.

Copyright © 2026 Couche 8 ASBL et contributeurs.
