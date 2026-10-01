# Fleight Board

> Whiteboard collaboratif temps réel, self-hosted, Docker-first, extensible par plugins et conçu dès le départ pour desktop, tablette et Apple Pencil.

![Statut](https://img.shields.io/badge/statut-conception-orange)
![Phase](https://img.shields.io/badge/phase-0%20%E2%80%94%20Proof%20of%20Concept-blue)
![Licence](https://img.shields.io/badge/licence-C8CL%20%2B%20commerciale-lightgrey)

> [!WARNING]
> **Projet en phase de conception.** Aucune version utilisable n'est encore disponible. Ce README décrit la cible du produit et sera mis à jour au fil de la réalisation. Les éléments marqués _(prévu)_ ne sont pas encore implémentés.

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
| Canvas standard (A4, A3, A2, 16:9, 4:3, personnalisé) | _(prévu)_ |
| Canvas infini (zoom, pan) | 🧪 Moteur de rendu prototypé (M0.2) |
| Primitives : rectangle, ellipse, ligne, flèche, polygone, texte, image | 🧪 Rectangle, ellipse et texte prototypés (M0.4) |
| Dessin libre : stylo, surligneur, gomme, couleur, épaisseur, opacité | 🧪 Stylo à pression prototypé (M0.3) |
| Sélection, groupes, copier/coller, duplication | 🧪 Sélection, déplacement, redimensionnement prototypés (M0.4) |
| Frames (conteneurs titrés, exportables) | _(prévu)_ |
| Connecteurs droits/orthogonaux, ancrages, labels, suivi des objets | 🧪 Connecteurs droits ancrés qui suivent les objets (M0.4) |
| Métadonnées structurées sur les objets | _(prévu)_ |

### Collaboration

| Fonctionnalité | Statut |
|---|---|
| Synchronisation temps réel via WebSocket | 🧪 Prototypée (M0.5), persistée dans PostgreSQL (M0.6) |
| Verrouillage temporaire des objets en cours d'édition | 🧪 Prototypé (M0.7) |
| Curseurs et présence (modes « Drawing only » / « Cursor visible ») | _(prévu)_ |
| Undo/redo individuel (chacun n'annule que ses propres actions) | _(prévu)_ |
| Audit log complet et non annulable | _(prévu)_ |
| Travail local temporaire pendant une coupure réseau, puis resynchronisation | _(prévu)_ |
| Mode présentation (navigation, zoom et focus synchronisés) | _(prévu)_ |

### Administration

| Fonctionnalité | Statut |
|---|---|
| Authentification locale + MFA TOTP | _(prévu)_ |
| Gestion des comptes Users / Admins | _(prévu)_ |
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
- interface dont les panneaux secondaires peuvent être masqués.

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
- l'état est persisté sous forme de **journal d'opérations + snapshots**.

### Règles de résolution

| Situation | Comportement |
|---|---|
| Alice déplace X, Bob change ensuite sa couleur, Alice fait Ctrl+Z | Seule la position est restaurée ; la couleur de Bob est conservée |
| Undo sur un objet supprimé entre-temps par un autre utilisateur | Undo ignoré, avec notification |
| Opérations faites pendant une coupure réseau en conflit avec des modifications distantes | Rejetées, avec notification (« N modifications n'ont pas pu être appliquées ») |
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
- Un Admin global qui crée un whiteboard y agit comme un User ; le rôle maximal qu'il peut déléguer est **Co-owner**.

### Accès temporaires

Un membre peut recevoir un accès **permanent**, **temporaire** (durée définie) ou **valable tant que le détenteur est connecté**.

## Partage

- **Code court** de 6 caractères (ex. `K7P4X2`), sans caractères ambigus (`O/0`, `I/1`, `S/5`). C'est un identifiant, pas un secret : il est protégé par du rate limiting et de la détection d'abus.
- **Session publique** : toute personne connaissant le code peut rejoindre.
- **Session privée** : chaque demande de connexion doit être acceptée.
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
│   ├── protocol/         # Schémas zod (objets, messages) versionnés
│   └── shared/           # Utilitaires communs (identifiants ULID…)
├── infrastructure/
│   └── compose/          # docker-compose de développement
└── docs/                 # Plan d'implémentation, rapports
```

À venir : `packages/permissions`, `packages/plugin-sdk`, `plugins/network`, `infrastructure/docker` (images de production), `tests/` (collaboration et e2e).

## Installation

_(prévu — disponible à partir de la première version déployable)_

```bash
git clone https://github.com/joblinours/fleight-board.git
cd fleight-board
cp .env.example .env    # adapter la configuration
docker compose up -d
```

Seront documentés : variables d'environnement, volumes, healthchecks (`/health`, `/ready`, `/metrics`), sauvegarde/restauration et procédure de mise à jour.

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
- il crée ou aligne `apps/api/.env` ;
- il lance l'API et le frontend, puis affiche les adresses PC et iPad.

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
| `pnpm build` | Build de production |
| `pnpm db:up` / `pnpm db:down` | Démarre / arrête PostgreSQL |

### Endpoints de l'API

| Endpoint | Rôle |
|---|---|
| `GET /health` | Liveness : le processus répond |
| `GET /ready` | Readiness : PostgreSQL est joignable (`503` sinon) |
| `WS /ws` | WebSocket ; le premier message doit être `HELLO` avec la version du protocole |

## Roadmap

Le plan détaillé (jalons, critères de validation, décisions) est tenu dans [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) sur la branche `dev`.

- [ ] **Phase 0 — Proof of Concept technique** : canvas desktop + iPad/Apple Pencil, objets structurés, connecteurs, WebSocket, 2+ utilisateurs, locks, undo individuel, persistance, reconnexion, audit log.
- [ ] **Phase 1 — Core MVP** : auth locale, Users/Admins, canvas standard et infini, primitives, texte, images, dessin libre, sélection, groupes, frames, connecteurs, undo/redo, collaboration temps réel, locks, curseurs, présence, sessions par code, public/privé, permissions, guests, audit log.
- [ ] **Phase 2 — Produit utilisable** : présentation, share links, import PDF/SVG/images, export SVG/PNG/PDF, rétention, limites de stockage, MFA, administration complète, transfert de propriété, reconnexion robuste, interface tablette complète.
- [ ] **Phase 3 — Système de plugins** : SDK, API, permissions, sandbox, installation ZIP, cycle de vie, marketplace, plugin Network.
- [ ] **Phase 4 — Auth enterprise** : LDAP, Active Directory, SAML, OIDC, mapping groupes → rôles.
- [ ] **Phase 5 — Scalabilité** : plusieurs backends, Redis, stockage S3, load balancer, workers.
- [ ] **Phase 6 — Écosystème** : marketplace avancé, plugins communautaires, draw.io, Mermaid, Visio.

## Sécurité

- Mots de passe hachés en Argon2id, sessions sécurisées avec expiration et rotation.
- Protection contre le brute force et rate limiting.
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
