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

- [ ] Pointer Events : distinction `mouse` / `touch` / `pen`
- [ ] Pression, `getCoalescedEvents()` quand disponible
- [ ] Palm rejection : contacts tactiles ignorés pendant qu'un stylet est actif
- [ ] Modes Pencil-only / Touch-only
- [ ] Pinch-zoom et pan à deux doigts
- [ ] Désactivation des gestes Safari parasites (double-tap zoom, sélection, menu contextuel)
- [ ] Outil stylo avec `perfect-freehand`, rendu local immédiat
- [ ] Page de test dédiée iPad

**Critère** : validé **sur ton iPad Air + Pencil 2** : tracé fluide, sans lag perceptible, pression visible, aucune trace de paume.

### M0.4 — Modèle d'objets

- [ ] Schémas `zod` : rectangle, ellipse, texte, trait libre, connecteur
- [ ] Création, sélection, déplacement, redimensionnement
- [ ] Connecteurs droits avec points d'ancrage, qui suivent les objets

**Critère** : on peut construire un petit diagramme relié en local.

### M0.5 — Serveur temps réel

- [ ] Fastify + `ws`, handshake avec version du protocole
- [ ] `JOIN_SESSION`, `LEAVE_SESSION`, opérations, `ACK`/`REJECT`
- [ ] Version par objet, séquence par board
- [ ] Interface `PubSub` (implémentation mémoire)
- [ ] Messages éphémères pour les gestes en cours

**Critère** : deux navigateurs voient les modifications de l'autre en temps réel.

### M0.6 — Persistance

- [ ] Schéma Drizzle : `boards`, `objects`, `operations`, `snapshots`
- [ ] Écriture transactionnelle opération + état courant
- [ ] Rechargement d'un board

**Critère** : redémarrer l'API ne perd rien.

### M0.7 — Locks

- [ ] Lock / unlock, timeout, libération à la déconnexion
- [ ] Indicateur visuel « en cours d'édition par … »

**Critère** : deux utilisateurs ne peuvent pas déplacer le même objet en même temps.

### M0.8 — Undo individuel

- [ ] Pile par utilisateur, opération `undo` côté serveur
- [ ] Règles D13

**Critère** : scénario Alice/Bob du README validé par un test automatisé.

### M0.9 — Reconnexion

- [ ] File locale, `SYNC_REQUEST`/`SYNC_RESPONSE`
- [ ] Rejets + notification groupée

**Critère** : couper le réseau 30 s pendant qu'on dessine, puis rétablir → état convergent sur tous les clients.

### M0.10 — Audit log

- [ ] Table `audit_logs` (timestamp, acteur, type d'acteur, action, objet, board, session, métadonnées)
- [ ] Une entrée par opération finale, y compris les undo

### M0.11 — Tests de collaboration

- [ ] Clients simulés headless : 2, 5, 20, 50 utilisateurs
- [ ] Créations, modifications, suppressions, locks, déconnexions et undo concurrents
- [ ] Vérification de convergence : tous les clients finissent avec le même état que le serveur

### Sortie de Phase 0 — go / no-go

- [ ] Rapport `docs/poc-report.md` : mesures de performance, retour iPad, limites constatées
- [ ] Revue avec toi avant de lancer la Phase 1

---

## 5. Phase 1 — Core MVP

**Objectif** : deux utilisateurs (ou plus) créent et modifient ensemble un whiteboard complet, déployé avec Docker Compose.

### M1.1 — Authentification et comptes

- [ ] Login username/email + mot de passe (Argon2id)
- [ ] Sessions en cookie `HttpOnly`/`Secure`/`SameSite`, expiration et rotation
- [ ] Rate limiting et protection brute force
- [ ] Premier Admin créé au démarrage via variables d'environnement
- [ ] Admin : créer / désactiver / supprimer des comptes, réinitialiser un mot de passe
- [ ] Demande de création de compte depuis l'interface

### M1.2 — Whiteboards

- [ ] Création : nom, description, canvas Standard (A4, A3, A2, 16:9, 4:3, Custom) ou Infinite
- [ ] Liste, renommage, suppression (immédiate en v1), masquage
- [ ] Code court à 6 caractères (alphabet sans `O 0 I 1 S 5`)

### M1.3 — Objets complets

- [ ] Primitives : rectangle, ellipse, ligne, flèche, polygone, texte, image
- [ ] Édition de texte (overlay DOM au-dessus du canvas)
- [ ] Upload d'images (limites côté serveur, `BlobStorage`)
- [ ] Dessin libre : stylo, surligneur, gomme, couleur, épaisseur, opacité
- [ ] Panneau de propriétés

### M1.4 — Sélection, groupes, frames

- [ ] Sélection simple, multiple, au lasso / rectangle
- [ ] Copier, coller, dupliquer, supprimer
- [ ] Grouper / dégrouper
- [ ] Frames : titre, contenu, ordre, déplacement avec le contenu

### M1.5 — Connecteurs

- [ ] Connecteurs orthogonaux avec routage simple
- [ ] Flèches, labels, reconnexion par glisser

### M1.6 — Présence

- [ ] Curseurs, usernames et couleurs
- [ ] Modes « Drawing only » / « Cursor visible »
- [ ] Liste des participants

### M1.7 — Permissions

- [ ] Package `permissions` : matrice rôle → actions, testée unitairement
- [ ] Rôles `Viewer < Editor < Presenter < Co-owner < Owner`
- [ ] Délégation limitée à son propre rôle ; Admin global plafonné à Co-owner
- [ ] Vérification serveur sur chaque requête REST et chaque message WebSocket
- [ ] Gestion des membres depuis l'interface

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
- Le README sur `main` est mis à jour à chaque release ; celui de `dev` au fil des fusions.
- Chaque jalon nécessitant l'iPad (M0.3, M0.9, M1.11) se termine par une demande de test de ta part.

---

## 8. Journal des décisions

| Date | Décision |
|---|---|
| 2026-10-01 | Plan validé ; décisions D1 à D22 actées |
| 2026-10-01 | M0.2 : niveau de détail — une forme de moins de 8 px à l'écran est dessinée en un simple aplat. Si les mesures sur iPad sont insuffisantes, prochaine étape : cache bitmap des objets statiques pendant le pan |
| 2026-10-01 | M0.1 : les packages internes sont consommés directement en TypeScript (pas de build) ; le bundle de production de l'API sera traité en M1.10 |
