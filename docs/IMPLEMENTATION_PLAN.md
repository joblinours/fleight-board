# Fleight Board — Plan d'implémentation

> **Statut : validé le 2026-10-01.**
> Ce document est tenu à jour au fil de la réalisation : cases cochées, nouvelles décisions, écarts par rapport au plan.

---

## 1. Décisions actées

| # | Sujet | Décision |
|---|---|---|
| D1 | Langage | TypeScript partout |
| D2 | Monorepo | pnpm workspaces + Turborepo |
| D3 | Frontend | React + Vite, moteur canvas maison en Canvas 2D |
| D4 | Traits | `perfect-freehand` (MIT) |
| D5 | Backend | Node.js LTS + Fastify + `ws` |
| D6 | Base | PostgreSQL + Drizzle ORM |
| D7 | Protocole | Schémas `zod` partagés, protocole versionné |
| D8 | Collaboration | Hybride à serveur autoritaire : opérations, version par objet, locks, journal + snapshots, queue locale |
| D9 | Redis | Absent en v1 ; interface `PubSub` avec implémentation mémoire |
| D10 | Fichiers | Volume Docker derrière une interface `BlobStorage` (S3 plus tard) |
| D11 | Import PDF | Chaque page devient une image de fond annotable |
| D12 | Exports | Côté client |
| D13 | Undo en conflit | On ne restaure que les propriétés encore égales à ce que l'utilisateur avait écrit ; objet supprimé → undo ignoré + notification |
| D14 | Hors ligne en conflit | Rejet + notification |
| D15 | Auth enterprise | Modules officiels signés, pas de plugins tiers |
| D16 | Rôles whiteboard | `Viewer < Editor < Presenter < Co-owner < Owner` (pas d'Admin de whiteboard) |
| D17 | Git | `main` ← `dev` ← `feature/*`, Conventional Commits |
| D18 | Matériel de test | iPad Air + Apple Pencil 2, iPadOS 27 |
| D19 | Presenter | Rôle cumulatif : un Presenter peut aussi éditer |
| D20 | Owner / Co-owner | Seul l'Owner supprime le board et transfère la propriété ; le Co-owner gère tout le reste (membres, partage, permissions) |
| D21 | Suppression | Immédiate en Phase 1 ; rétention / corbeille en Phase 2 |
| D22 | Lint / formatage | Biome |

---

## 2. Outillage commun

| Domaine | Outil |
|---|---|
| Lint + formatage | Biome (un seul outil, rapide) |
| Tests unitaires / intégration | Vitest |
| Tests navigateur / e2e | Playwright (Chromium, Firefox, WebKit) |
| Tests base de données | PostgreSQL réel dans Docker (pas de mock) |
| CI | GitHub Actions : lint, typecheck, tests, build, image Docker |
| Index spatial | `rbush` (MIT) pour le culling et le hit-testing |
| Identifiants | ULID (triables dans le temps) |

**Définition de « terminé » pour chaque tâche** : code + tests + CI verte + README/docs à jour si le comportement visible change.

---

## 3. Modèle technique de collaboration

Ce modèle est le cœur du projet ; il est fixé dès la Phase 0.

### 3.1 Opération

```ts
type Operation = {
  opId: string;          // ULID généré par le client (idempotence)
  boardId: string;
  actorId: string;       // user ou guest, déduit de la session côté serveur
  kind: 'create' | 'update' | 'delete' | 'undo' | ...;
  objectId: string;
  baseVersion: number;   // version de l'objet vue par le client
  patch: Record<string, unknown>;     // propriétés modifiées
  previous?: Record<string, unknown>; // valeurs avant modification (rempli par le serveur)
};
```

### 3.2 Cycle d'une opération

```text
Client                         Serveur
  │ applique localement           │
  │ (optimiste) + met en file     │
  │ ──────── OP ────────────────► │ valide schéma + permissions + lock
  │                               │ applique, version++ , seq++ du board
  │                               │ écrit journal + audit (transaction)
  │ ◄──────── ACK(seq) ────────── │ diffuse OP(seq) aux autres clients
  │   ou REJECT(raison)           │
  │ annule l'optimisme si REJECT  │
```

- Chaque board a un **numéro de séquence** monotone : un client sait exactement quelles opérations il a reçues.
- Les opérations **à haute fréquence** (glisser, tracer) circulent en messages éphémères pendant le geste ; seule l'opération finale (pointer up) est journalisée, auditée et empilée dans l'undo.

### 3.3 Locks

- `LOCK_OBJECT` au pointer down, `UNLOCK_OBJECT` au pointer up.
- Timeout de sécurité (ex. 10 s sans activité) et libération à la déconnexion.
- Un objet verrouillé par un autre est non modifiable et affiché avec le nom de l'éditeur.

### 3.4 Undo individuel

- Pile d'undo par utilisateur et par board, côté client, reconstruite depuis le journal au rechargement.
- Un undo envoie une opération `undo` ; le serveur ne restaure que les propriétés **dont la valeur actuelle est encore celle écrite par l'utilisateur**.
- Objet supprimé entre-temps → undo ignoré + notification.
- L'undo est audité ; l'audit n'est jamais annulé.

### 3.5 Reconnexion

- Le client garde : dernier `seq` confirmé, file des opérations non confirmées.
- À la reconnexion : `SYNC_REQUEST(lastSeq)` → le serveur renvoie les opérations manquantes (ou un snapshot si l'écart est trop grand), puis le client renvoie sa file.
- Une opération dont la `baseVersion` est dépassée sur une propriété modifiée ailleurs est rejetée → notification groupée.

### 3.6 Persistance

- Table `operations` (journal append-only) + table `objects` (état courant) + `snapshots` périodiques.
- Chargement d'un board : état courant depuis `objects`, sans rejouer le journal.

---

## 4. Phase 0 — Proof of Concept technique

**Objectif** : valider les risques majeurs (Apple Pencil, rendu, synchronisation) avant de construire le produit.

### M0.1 — Socle du monorepo

- [x] Monorepo pnpm + Turborepo : `apps/web`, `apps/api`, `packages/{protocol,canvas,collaboration,shared}`
- [x] TypeScript strict, Biome, Vitest
- [x] `docker-compose.dev.yml` avec PostgreSQL
- [x] CI GitHub Actions (lint, typecheck, tests, build)
- [x] README : section Développement

**Critère** : `pnpm install && pnpm dev` lance le web et l'API ; la CI est verte.

### M0.2 — Moteur de rendu

- [x] Caméra (zoom, pan) et conversion écran ↔ monde
- [x] Graphe de scène, rendu Canvas 2D, gestion du `devicePixelRatio`
- [x] Index spatial (`rbush`) : culling du viewport et hit-testing
- [x] Rendu à la demande (dirty flag), pas de boucle permanente
- [x] Banc de performance : 5 000 objets (page `#/bench`, benchmark scripté de 6 s)

**Critère** : 60 fps en pan/zoom avec 5 000 objets sur desktop et iPad Air.
→ **Validé sur matériel réel, à 20 000 objets (4× la cible)** — benchmark scripté de 6 s :

| Appareil | Densité | FPS moyen | Frame p95 | Frames perdues |
|---|---|---:|---:|---:|
| Desktop — i7-14700K, RTX 4060, Kali Linux | ×1 | 103,7 | 20,9 ms | 2,2 % |
| iPad Air + Safari (écran 60 Hz) | ×2 | 51,1 | 22,0 ms | 3,9 % |

_À 20 000 objets, l'iPad reste proche de sa fréquence d'affichage avec moins de 4 % de frames perdues ; la cible de 5 000 objets est donc tenue avec marge. Pour référence, Chromium headless sans GPU : 47 fps à 5 000 objets (rastérisation logicielle)._

### M0.3 — Entrées et Apple Pencil

- [x] Pointer Events : distinction `mouse` / `touch` / `pen`
- [x] Pression, `getCoalescedEvents()` quand disponible
- [x] Palm rejection : contacts tactiles ignorés pendant qu'un stylet est actif (et 500 ms après son levé) ; un trait tactile commencé par la paume est annulé quand la pointe se pose
- [x] Modes : Auto (le doigt dessine jusqu'à la détection d'un stylet, puis navigue), Pencil seul, Doigt dessine
- [x] Pinch-zoom et pan à deux doigts ; un second doigt transforme un trait au doigt en pinch
- [x] Désactivation des gestes Safari parasites (double-tap zoom, gestures, loupe, menu contextuel)
- [x] Outil stylo avec `perfect-freehand`, rendu local immédiat sur un calque dédié au trait en cours
- [x] Page de test dédiée iPad (`#/ink`) avec panneau de diagnostic

**Critère** : validé **sur ton iPad Air + Pencil 2** : tracé fluide, sans lag perceptible, pression visible, aucune trace de paume.
→ **Validé le 2026-10-01 sur iPad Air + Apple Pencil 2 (iPadOS 27, Safari)** : tracé fluide, pression et palm rejection conformes ; fréquence d'échantillonnage du Pencil ≥ 94 Hz.

### M0.4 — Modèle d'objets

- [x] Schémas `zod` : rectangle, ellipse, texte, trait libre, connecteur (`packages/protocol`)
- [x] Package `@fleight/document` : état du board modifié par opérations atomiques, chacune retournant son inverse (base de l'undo M0.8) ; utilisable côté client et serveur
- [x] Création, sélection (simple, Maj pour ajouter), déplacement, redimensionnement par poignées, suppression
- [x] Connecteurs droits avec 4 points d'ancrage, qui suivent les objets
- [x] Édition du texte et des labels (double-tap / double-clic), outil stylo produisant des objets `stroke`
- [x] Page de test `#/board` avec diagramme d'exemple

**Critère** : on peut construire un petit diagramme relié en local.

### M0.5 — Serveur temps réel

- [x] Fastify + `ws`, handshake avec version du protocole
- [x] `JOIN`, `LEAVE`, `OPS`, `ACK`/`REJECT`, `SYNC_REQUEST`/`SNAPSHOT`, arrivée/départ des participants
- [x] Version par objet, séquence par board (`BoardRoom`)
- [x] Interface `PubSub` (implémentation mémoire) utilisée pour la diffusion (`CollaborationHub`, indépendant du transport)
- [x] Gestes en cours : lots regroupés à ~30 Hz côté client, rattachés à un `gesture` dont le dernier lot est marqué `final`
- [x] Client optimiste (`CollaborationClient`) : application locale immédiate, rebase des modifications non confirmées sur les opérations distantes qui touchent les mêmes objets, resynchronisation après un rejet
- [x] Page `#/board/<id>` : statut de connexion, participants

**Critère** : deux navigateurs voient les modifications de l'autre en temps réel.
→ **Validé** : test de bout en bout dans deux navigateurs Chromium (diagramme d'exemple, déplacement, création), et test de convergence aléatoire (3 clients, 40 graines × 60 actions, ordres de livraison aléatoires).

### M0.6 — Persistance

- [x] Schéma Drizzle : `boards`, `objects`, `operations`, `snapshots` ; migrations SQL versionnées (`apps/api/drizzle`), appliquées au démarrage
- [x] Écriture transactionnelle état courant + journal (`PostgresBoardStore`) ; un lot n'est confirmé (`ACK`) et diffusé qu'une fois enregistré
- [x] Journal : une entrée par lot hors geste, **une seule entrée par geste** (effet net, au lot final, à `GESTURE_END` ou au départ de l'auteur)
- [x] Copie complète du board tous les 500 lots (`snapshots`)
- [x] Rechargement d'un board ; déchargement de la mémoire quand le dernier participant part
- [x] Échec d'enregistrement : board déchargé, participants déconnectés ; à leur retour, ils retrouvent l'état réellement enregistré
- [x] Tests d'intégration sur un vrai PostgreSQL (service PostgreSQL dans la CI)

**Critère** : redémarrer l'API ne perd rien.
→ **Validé** : test d'intégration (lot créé via WebSocket, arrêt de l'API, nouvelle instance : état et versions restaurés) et essai dans le navigateur (diagramme d'exemple + déplacement, redémarrage de l'API, rechargement : tout est là).

### M0.7 — Locks

- [x] Protocole `LOCK` / `UNLOCK`, diffusion `LOCKS`, refus `LOCK_DENIED`, rejet `LOCKED` d'un lot touchant un objet verrouillé par un autre
- [x] Table de verrous côté serveur : tout ou rien, expiration après 10 s sans activité (renouvelée par les opérations du détenteur et toutes les 4 s par le client), balayage périodique, libération au départ et à la suppression de l'objet
- [x] La libération d'un verrou est diffusée après les dernières modifications de son détenteur
- [x] Éditeur : verrou au début d'un glisser / redimensionnement, libéré au relâchement ; verrou pendant l'édition d'un texte ; objet verrouillé par un autre ni sélectionnable, ni déplaçable, ni éditable, ni supprimable
- [x] Indicateur visuel « ✎ Nom » à la couleur du participant

**Critère** : deux utilisateurs ne peuvent pas déplacer le même objet en même temps.
→ **Validé** : tests (table de verrous, sessions à plusieurs clients, outil de sélection) et essai dans deux navigateurs : pendant qu'Alice tient le Router, Bob voit « ✎ Alice » et ne peut pas le déplacer ; dès qu'Alice relâche, Bob le déplace.

### M0.8 — Undo individuel

- [x] Historique **individuel** côté client (`UndoHistory`, `@fleight/document`) : une entrée par geste ou commande, état avant/après de chaque objet touché ; seules les actions locales y entrent ; rétablissement (redo) ; 200 entrées
- [x] Règles D13 : seules les propriétés encore égales à ce que l'utilisateur a écrit sont restaurées ; objet supprimé entre-temps → ignoré + notification ; objet verrouillé par un autre → ignoré ; annuler une suppression restaure aussi les connecteurs détachés
- [x] L'annulation passe par les opérations normales (verrous, persistance, diffusion) et est **journalisée** avec son intention (`undo` / `redo`, colonne `intent`, migration `0001`)
- [x] Éditeur : Ctrl/⌘+Z, Ctrl/⌘+Maj+Z, Ctrl+Y, boutons Annuler / Rétablir, message en cas d'annulation partielle

**Critère** : scénario Alice/Bob du README validé par un test automatisé.
→ **Validé** : test unitaire (`UndoHistory`) et test de collaboration à travers le serveur (convergence des deux clients, journal `undo` puis `redo`), plus essai dans deux navigateurs : Alice déplace le Router, Bob le renomme, Alice fait Ctrl+Z → le Router revient à sa place et garde le nom donné par Bob.

### M0.9 — Reconnexion

- [x] File locale : hors connexion, les modifications s'appliquent et restent en attente ; reconnexion automatique (délai croissant, immédiate au retour du réseau)
- [x] À la reconnexion : état complet (`JOINED`), lots déjà appliqués dont l'accusé s'est perdu retirés de la file, lots non confirmés renvoyés (dédoublonnés par le serveur), modifications hors ligne envoyées **une action par lot**
- [x] Conflits au niveau de la **propriété** : un lot qui modifie une propriété changée par un autre client après sa `baseSeq` est refusé (`CONFLICT`) ; identité de client stable à travers les reconnexions (`clientId`)
- [x] Rejets + notification groupée après resynchronisation ; indicateur « Hors ligne — N modifications en attente »

**Critère** : couper le réseau 30 s pendant qu'on dessine, puis rétablir → état convergent sur tous les clients.
→ **Validé** : test aléatoire à 3 clients avec coupures et reconnexions (1 000 graines × 60 actions en vérification ponctuelle, 30 en CI), scénarios ciblés (modifications hors ligne, conflit, accusé perdu, geste interrompu), et essai dans deux navigateurs avec coupure réseau (`setOffline`) : convergence, conflit signalé.

### M0.10 — Audit log

- [x] Table `audit_logs` (timestamp, acteur, type d'acteur, action, objet, board, session, métadonnées), écrite dans la même transaction que le journal
- [x] Une entrée par opération finale, y compris les undo
- [x] Lecture : `GET /boards/:boardId/audit` et page `#/audit/<board>`

→ **Validé** : tests unitaires (une entrée par opération, détails), tests de collaboration (un geste de plusieurs lots = une entrée, annulation et rétablissement marqués, lot refusé non audité), tests PostgreSQL (écriture transactionnelle, lecture HTTP), et essai dans un navigateur : un déplacement → une ligne « geste », Ctrl+Z → « annulation », Ctrl+Maj+Z → « rétablissement ».

### M0.11 — Tests de collaboration

- [x] Clients simulés headless : 2, 5, 20, 50 utilisateurs (`SimulatedUser`), en mémoire (ordre de livraison aléatoire) et sur le vrai WebSocket + PostgreSQL (`pnpm load`)
- [x] Créations, modifications, suppressions, locks, déconnexions et undo concurrents
- [x] Vérification de convergence : tous les clients finissent avec le même état que le serveur, sans modification en attente ni verrou résiduel

→ **Validé** : convergence sur 1 050 scénarios aléatoires avec enregistrement lent, en vérification ponctuelle (500 à 2 utilisateurs, 300 à 5, 150 à 20, 100 à 50 ; 21 en CI), test de charge WebSocket à 50 utilisateurs convergent 20 fois sur 20, et test de charge de 30 s par palier sur WebSocket + PostgreSQL (machine de 4 cœurs partagée par l'API, la base et le générateur) :

| Utilisateurs | Lots/s | ACK p50 / p95 / p99 (ms) | Diffusion p50 / p95 / p99 (ms) | Convergence |
|---|---|---|---|---|
| 2 | 12 | 6.1 / 9.4 / 12.5 | 6.3 / 9.6 / 12.6 | ✅ |
| 5 | 28 | 5.2 / 9.3 / 12.9 | 5.4 / 9.5 / 13.2 | ✅ |
| 20 | 115 | 4.9 / 10.8 / 14.3 | 5.3 / 11.2 / 14.8 | ✅ |
| 50 | 280 | 8.5 / 18 / 27 | 9.1 / 18.7 / 27.8 | ✅ |

Au-delà de l'objectif, sur un seul board : 100 utilisateurs → ACK p50 115 ms, 200 → 430 ms, toujours convergents ; mesure limitée par le générateur (un seul processus Node qui fait tourner tous les clients) sur la même machine.

### Sortie de Phase 0 — go / no-go

- [x] Rapport [`docs/poc-report.md`](poc-report.md) : mesures de performance, retour iPad, limites constatées
- [x] Revue avec toi avant de lancer la Phase 1 → **GO** le 2026-10-02

---

## 5. Phase 1 — Core MVP

**Objectif** : deux utilisateurs (ou plus) créent et modifient ensemble un whiteboard complet, déployé avec Docker Compose.

### M1.1 — Authentification et comptes

- [x] Login username/email + mot de passe (Argon2id)
- [x] Sessions en cookie `HttpOnly`/`Secure`/`SameSite`, expiration et rotation
- [x] Rate limiting et protection brute force
- [x] Premier Admin créé au démarrage via variables d'environnement
- [x] Admin : créer / désactiver / supprimer des comptes, réinitialiser un mot de passe
- [x] Demande de création de compte depuis l'interface

→ **Validé** : tests PostgreSQL (connexion par nom ou e-mail, cookie, blocage après 5 échecs, limite par IP, renouvellement et expiration des sessions, demande puis validation, mot de passe temporaire, révocation, droits Admin, contrôle d'origine, WebSocket authentifié et fermé à la désactivation) et parcours complet dans deux navigateurs.

### M1.2 — Whiteboards

- [x] Création : nom, description, canvas Standard (A4, A3, A2, 16:9, 4:3, Custom) ou Infinite
- [x] Liste, renommage, suppression (immédiate en v1), masquage
- [x] Code court à 6 caractères (alphabet sans `O 0 I 1 S 5`)

→ **Validé** : tests PostgreSQL (création infinie ou standard, liste et masquage, code insensible à la casse, droits du propriétaire, suppression immédiate, identifiant choisi, audit, WebSocket refusé sur un board inexistant et fermé à la suppression) et parcours dans deux navigateurs (création A4 paysage, rejoindre par code, renommer, masquer, suppression pendant la session).

### M1.3 — Objets complets

- [x] Primitives : rectangle, ellipse, ligne, flèche, polygone, texte, image
- [x] Édition de texte (overlay DOM au-dessus du canvas)
- [x] Upload d'images (limites côté serveur, `BlobStorage`)
- [x] Dessin libre : stylo, surligneur, gomme, couleur, épaisseur, opacité
- [x] Panneau de propriétés

→ **Validé** : tests des outils (polygone, ligne, flèche, surligneur, gomme), des propriétés par type d'objet, de la géométrie du polygone et de la détection des images ; tests PostgreSQL de l'import (type lu dans le fichier, dimensions, déduplication, refus d'un SVG, limite de taille, droits) ; parcours dans le navigateur avec un second participant.

### M1.4 — Sélection, groupes, frames

- [x] Sélection simple, multiple, au lasso / rectangle
- [x] Copier, coller, dupliquer, supprimer
- [x] Grouper / dégrouper
- [x] Frames : titre, contenu, ordre, déplacement avec le contenu

→ **Validé** : tests du document (contenu des frames, groupes, copier-coller avec remappage, ordre) et des outils (rectangle de sélection, lasso, groupes, frame déplacée avec son contenu, presse-papiers) ; parcours dans le navigateur, dont un collage d'un board à l'autre.

### M1.5 — Connecteurs

- [x] Connecteurs orthogonaux avec routage simple
- [x] Flèches, labels, reconnexion par glisser

→ **Validé** : tests du routage (Z, L, ligne droite, cible derrière la sortie, extrémités libres), du contact sur le tracé et le label, de la reconnexion par glisser (autre forme, point libre, verrou) ; parcours dans deux navigateurs (tracé qui suit une forme déplacée chez l'autre participant).

### M1.6 — Présence

- [x] Curseurs, usernames et couleurs
- [x] Modes « Drawing only » / « Cursor visible »
- [x] Liste des participants

→ **Validé** : tests du relais des curseurs (débit limité côté client et serveur, « Drawing only » appliqué par le serveur, mode conservé à la reconnexion, curseur effacé au départ) et des couleurs ; parcours dans deux navigateurs.

### M1.7 — Permissions

- [x] Package `permissions` : matrice rôle → actions, testée unitairement
- [x] Rôles `Viewer < Editor < Presenter < Co-owner < Owner`
- [x] Délégation limitée à son propre rôle ; Admin global plafonné à Co-owner
- [x] Vérification serveur sur chaque requête REST et chaque message WebSocket
- [x] Gestion des membres depuis l'interface

### M1.8 — Sessions, invités et accès

- [ ] Rejoindre par code (rate limiting, cooldown)
- [ ] Session publique : entrée directe
- [ ] Session privée : demande d'accès acceptée/refusée par le détenteur, en temps réel
- [ ] Guest : username, sans compte
- [ ] Accès permanent, temporaire, ou valable tant que le détenteur est connecté

### M1.9 — Audit (interface)

- [ ] Consultation de l'audit d'un board (filtrable)
- [ ] Consultation globale pour l'Admin

### M1.10 — Déploiement

- [ ] Dockerfiles multi-stage (web servi par l'API ou un Nginx, à trancher en M1.10)
- [ ] `docker-compose.yml` + `.env.example`, volumes, healthchecks `/health` et `/ready`
- [ ] Migrations automatiques au démarrage
- [ ] Logs structurés (JSON)
- [ ] Documentation : installation, Portainer, sauvegarde/restauration, mise à jour

### M1.11 — Interface tablette

- [ ] Barre d'outils compacte, panneaux masquables
- [ ] Portrait / paysage, clavier externe
- [ ] Tests manuels sur ton iPad à chaque jalon

**Sortie de Phase 1** : release `v0.1.0` fusionnée sur `main`.

---

## 6. Phases suivantes (détaillées à l'issue de la Phase 1)

| Phase | Contenu |
|---|---|
| **2 — Produit utilisable** | Présentation, share links Viewer/Editor, import PDF/SVG/images, export SVG/PNG/PDF, rétention/corbeille, limites de stockage, MFA TOTP, administration complète, transfert de propriété, « Deleted User », reconnexion robuste |
| **3 — Plugins** | Manifest + permissions, SDK, plugins front en iframe/Web Worker, installation ZIP, cycle de vie, marketplace, plugin Network |
| **4 — Auth enterprise** | Modules officiels signés LDAP / AD / SAML / OIDC, mapping groupes → rôles |
| **5 — Scalabilité** | `PubSub` Redis, plusieurs instances API, affinité de board, S3/MinIO, load balancer |
| **6 — Écosystème** | Marketplace avancé, plugins communautaires, draw.io, Mermaid, Visio |

---

## 7. Organisation

- Une branche `feature/*` par jalon (ex. `feature/m0.2-render-engine`).
- **Une PR vers `dev` dès qu'un jalon Mx.x est fonctionnel.**
- **Une PR `dev` → `main` à chaque fin de phase**, qui correspond à une release.
- **Chaque jalon ajoute sa fiche de test** (lien + étapes) dans `apps/web/src/milestones.ts`, affichée sur la page d'accueil.
- `./scripts/dev.sh` lance l'environnement complet (base, configuration, API, frontend).
- Le README sur `main` est mis à jour à chaque release ; celui de `dev` au fil des fusions.
- Chaque jalon nécessitant l'iPad (M0.3, M0.9, M1.11) se termine par une demande de test de ta part.

---

## 8. Journal des décisions

| Date | Décision |
|---|---|
| 2026-10-01 | Plan validé ; décisions D1 à D22 actées |
| 2026-10-02 | M1.3 : ligne et flèche sont des connecteurs à extrémités libres (même objet, sans accrochage) ; polygone à sommets normalisés dans son cadre ; gomme « objet » (efface les traits à main levée touchés) ; images stockées sous leur empreinte SHA-256 (dédupliquées), type lu dans le fichier et SVG refusé (risque de script) ; les fichiers d'un board supprimé restent sur disque, nettoyage prévu avec la rétention (Phase 2) ; un réglage du panneau devient aussi le style des prochains objets. Dans un patch, `null` **retire** une propriété facultative : sans cela, annuler un réglage d'opacité sur un objet qui n'en avait pas produisait `undefined`, perdu en JSON — le client et le serveur divergeaient |
| 2026-10-02 | M1.4 : un groupe est un `groupId` partagé (pas d'objet conteneur) : un appui sur un membre sélectionne tout le groupe, grouper des objets déjà groupés les fusionne. Une frame est un objet placé sous le contenu ; son contenu n'est pas stocké mais calculé (objets entièrement à l'intérieur) au début du déplacement, sans ce que d'autres participants modifient ; on la saisit par son bord ou son bandeau de titre. Copier/coller passe par le presse-papiers système (texte préfixé, validé au collage), donc fonctionne entre boards ; une extrémité de connecteur accrochée à un objet non copié devient un point libre |
| 2026-10-02 | M1.5 : le tracé n'est pas stocké mais recalculé à l'affichage depuis les extrémités (`routing: orthogonal`, absent = droit, donc les connecteurs existants ne changent pas) : chaque client obtient le même tracé sans opération supplémentaire quand une forme bouge. Routage simple : sortie perpendiculaire à l'ancrage sur 24 unités, puis un coude (L) ou deux (Z), sans contournement d'obstacles. Le label est centré à mi-longueur du tracé ; son emprise est estimée sans mesure du texte pour que le test de contact reste indépendant du DOM. L'outil Connecteur trace en orthogonal par défaut, Ligne et Flèche restent droites |
| 2026-10-02 | M1.6 : la couleur d'un participant est attribuée par le serveur (une couleur libre du board, dérivée de l'utilisateur pour rester stable) et sert au curseur comme aux verrous. Les curseurs sont relayés sans être enregistrés ni journalisés, en coordonnées monde (chacun les voit à sa place quel que soit son zoom), limités à ~20 envois/s par le client et 50/s par le serveur. « Drawing only » est appliqué par le serveur : il ne relaie pas le curseur d'un participant dans ce mode, même si son client l'envoie. Le mode est une préférence du navigateur, renvoyée à chaque connexion |
| 2026-10-02 | M1.7 : le propriétaire reste dans `boards.owner_id`, les autres rôles dans `board_members` ; « Owner » ne s'attribue pas, il se transfère (l'ancien propriétaire devient Co-owner), ce qui plafonne naturellement toute délégation — Admin compris — à Co-owner. L'Admin global n'a aucun droit implicite sur un board (il garde la lecture de l'audit). En attendant les sessions publiques/privées (M1.8), chaque board règle l'accès des non-membres qui ont le lien ou le code : Editor (défaut, comportement antérieur), Viewer ou aucun ; un rôle de membre l'emporte même s'il est plus faible. Le hub reçoit une fonction `authorize` : rôle vérifié au JOIN, puis sur chaque OPS/LOCK ; quand les membres changent, il réévalue les sessions ouvertes (nouveau rôle diffusé, verrous rendus, déconnexion 4403 sans accès) |
| 2026-10-02 | M1.2 : les boards sont créés par l'API (plus de création implicite au premier JOIN) ; un board existant reste ouvrable par tout utilisateur connecté qui a son lien ou son code jusqu'aux permissions (M1.7) et aux sessions publiques/privées (M1.8). Supprimer le compte du propriétaire conserve ses boards (propriétaire vide, à réattribuer en M1.7). Formats en unités monde à 96 par pouce (A4 = 794 × 1123) ; les objets peuvent déborder de la page |
| 2026-10-02 | M1.1 : l'auteur journalisé devient l'**utilisateur** (nom du compte affiché aux autres participants) ; la détection de conflits reste par **client** (deux appareils d'un même compte sont traités comme deux participants). Le WebSocket exige une session ; l'audit d'un board est réservé aux Admins en attendant les propriétaires (M1.2). Cookie `Secure` seulement en HTTPS, pour que l'iPad fonctionne en HTTP sur le réseau local de développement |
| 2026-10-02 | **Fin de Phase 0 : GO** pour la Phase 1 (rapport `docs/poc-report.md` validé) |
| 2026-10-02 | M0.11 : **enregistrement groupé** (group commit) — les lots arrivés pendant l'enregistrement d'un board partent ensemble dans la transaction suivante, l'`ACK` restant postérieur à l'enregistrement. À 50 utilisateurs actifs, l'ACK passe de 340 ms (p50) à 8 ms : une transaction par lot plafonnait un board à ~190 lots/s |
| 2026-10-02 | M0.11 : deux bugs de convergence trouvés par le test de charge (sur le vrai WebSocket, quand l'enregistrement prend du retard sur les états complets envoyés immédiatement) et corrigés côté client — (1) un lot diffusé après un `JOINED`/`SNAPSHOT` qui l'inclut déjà était réappliqué et ramenait des objets en arrière : un lot de séquence déjà connue est désormais ignoré ; (2) les lots envoyés avant une demande de resynchronisation étaient réappliqués par-dessus l'état complet qui les incluait déjà, écrasant des modifications plus récentes : ils sont retirés de la file à la réception de l'état. Le test en mémoire simule désormais un enregistrement lent pour couvrir ces cas |
| 2026-10-02 | M0.11 : bug trouvé par le test à 50 utilisateurs et corrigé — un refus de verrou arrivé après qu'un renouvellement a obtenu ce verrou faisait oublier l'objet au client, qui ne le rendait pas (verrou fantôme jusqu'à l'expiration de 10 s) ; le client rend désormais tout verrou accordé qu'il ne demande plus |
| 2026-10-02 | M0.10 : l'audit est dérivé du journal (une entrée par opération de l'effet net d'un lot ou d'un geste), sans clé étrangère vers `boards` pour survivre à la suppression d'un board ; acteur = client et type `client` jusqu'aux comptes (M1.1), le nom affiché est conservé dans les métadonnées en attendant |
| 2026-10-02 | M0.9 : en cas de modifications concurrentes d'une même propriété, le **premier lot arrivé au serveur l'emporte**, le second est refusé (`CONFLICT`) puis resynchronisé — remplace le « dernier qui écrit gagne » de M0.5 ; des propriétés différentes d'un même objet restent fusionnées |
| 2026-10-02 | M0.9 : deux bugs trouvés par le test aléatoire et corrigés — (1) un board déchargé de la mémoire pendant qu'un participant le rejoignait (course entre départ du dernier et arrivée du suivant, présente depuis M0.6) ; (2) une resynchronisation demandée juste avant une coupure n'était jamais redemandée |
| 2026-10-01 | M0.8 : l'historique vit côté client pendant la session ; sa reconstruction depuis le journal au rechargement attend l'authentification (M1.1), car l'acteur journalisé est encore une connexion et non un utilisateur |
| 2026-10-01 | M0.7 : les verrous ne sont pas persistés (état éphémère en mémoire du serveur) ; le client verrouille de façon optimiste — en cas de course, le serveur refuse le lot (`LOCKED`) et le client est resynchronisé |
| 2026-10-01 | M0.6 : `ACK` et diffusion après l'enregistrement (durabilité avant latence ; quelques ms en local). Nouveau message `GESTURE_END` quand tous les lots d'un geste sont déjà partis au relâchement |
| 2026-10-01 | M0.5 : les gestes ne passent pas par des messages éphémères séparés mais par des lots d'opérations réels, regroupés à ~30 Hz et rattachés à un geste (`final` au pointer up) : l'état reste convergent pour un participant qui arrive en cours de geste, et la journalisation (M0.6) pourra ne conserver que l'effet net de chaque geste |
| 2026-10-01 | M0.5 : sans persistance (M0.6), l'état d'un board vit en mémoire du serveur |
| 2026-10-01 | M0.4 : un connecteur s'accroche à l'un des 4 ancrages (haut, droite, bas, gauche) ; supprimer un objet transforme les extrémités accrochées en points libres plutôt que de supprimer les connecteurs ; les points d'un trait sont relatifs à son coin (déplacer ne recalcule pas le tracé) |
| 2026-10-01 | M0.2 : niveau de détail — une forme de moins de 8 px à l'écran est dessinée en un simple aplat. Si les mesures sur iPad sont insuffisantes, prochaine étape : cache bitmap des objets statiques pendant le pan |
| 2026-10-01 | M0.1 : les packages internes sont consommés directement en TypeScript (pas de build) ; le bundle de production de l'API sera traité en M1.10 |
