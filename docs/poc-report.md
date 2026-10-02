# Fleight Board — Rapport de fin de Phase 0 (Proof of Concept)

**Date** : 2 octobre 2026 · **Branche** : `dev` · **Jalons** : M0.1 à M0.11 (PR #1 à #11)

## 1. Résumé

La Phase 0 devait lever les trois risques majeurs du projet avant de construire le produit : **l'Apple Pencil sur iPad**, **les performances de rendu** et **la synchronisation temps réel**. Les trois sont levés, mesures à l'appui.

| Risque | Verdict | Preuve principale |
|---|---|---|
| Apple Pencil / iPad | ✅ Levé | Validé sur ton iPad Air + Pencil 2 : tracé fluide, pression, palm rejection, ≥ 94 Hz |
| Rendu | ✅ Levé | 20 000 objets (4× la cible) : 103,7 fps desktop, 51,1 fps iPad (écran 60 Hz) |
| Synchronisation | ✅ Levé | 50 utilisateurs sur un board : ACK p50 8,5 ms, p95 18 ms, convergence systématique |

**Recommandation : GO pour la Phase 1**, sous réserve des validations de la [section 7](#7-à-valider-par-toi-avant-le-go).

## 2. Ce qui a été construit

Un whiteboard collaboratif minimal mais complet de bout en bout :

- **Canvas** maison en Canvas 2D : caméra, index spatial `rbush`, rendu à la demande, niveau de détail ;
- **Entrées** : Pointer Events, pression, événements coalescés, palm rejection, 3 modes (Auto, Pencil seul, Doigt dessine), pinch/pan, tracé `perfect-freehand` sur calque dédié ;
- **Objets** : rectangle, ellipse, texte, trait, connecteur ancré, avec sélection, déplacement, redimensionnement, édition de texte ;
- **Collaboration** : serveur autoritaire, opérations atomiques versionnées, client optimiste avec rebase, gestes regroupés à ~30 Hz ;
- **Persistance** : PostgreSQL (état courant + journal + snapshots), `ACK` seulement après enregistrement, enregistrement groupé ;
- **Verrous** d'édition (TTL 10 s, renouvelés), **undo/redo individuel** (règle D13), **reconnexion** avec file hors ligne et détection de conflits par propriété ;
- **Audit log** : une entrée par opération finale, annulations comprises ;
- **Outillage** : `./scripts/dev.sh`, page d'accueil avec une fiche de test par jalon, CI (lint, typecheck, tests avec PostgreSQL), test de charge `pnpm load`.

En chiffres : ~11 900 lignes de TypeScript, **192 tests** automatisés, CI verte sur chaque PR.

## 3. Mesures

### Rendu (M0.2) — benchmark scripté de 6 s à 20 000 objets

| Appareil | FPS moyen | Frame p95 | Frames perdues |
|---|---:|---:|---:|
| Desktop — i7-14700K, RTX 4060 | 103,7 | 20,9 ms | 2,2 % |
| iPad Air + Safari (60 Hz) | 51,1 | 22,0 ms | 3,9 % |

### Apple Pencil (M0.3)

Validé par toi le 1er octobre sur iPad Air + Pencil 2 (iPadOS 27, Safari) :
- tracé sans lag perceptible ;
- pression visible ;
- aucune trace de paume ;
- échantillonnage ≥ 94 Hz.

### Collaboration (M0.11) — WebSocket + PostgreSQL, 30 s par palier

| Utilisateurs | Lots/s | ACK p50 / p95 / p99 (ms) | Diffusion p50 / p95 / p99 (ms) | Convergence |
|---|---|---|---|---|
| 2 | 12 | 6,1 / 9,4 / 12,5 | 6,3 / 9,6 / 12,6 | ✅ |
| 5 | 28 | 5,2 / 9,3 / 12,9 | 5,4 / 9,5 / 13,2 | ✅ |
| 20 | 115 | 4,9 / 10,8 / 14,3 | 5,3 / 11,2 / 14,8 | ✅ |
| 50 | 280 | 8,5 / 18 / 27 | 9,1 / 18,7 / 27,8 | ✅ |

_Machine de 4 cœurs partagée par l'API, PostgreSQL et le générateur. Chez toi, à 20 utilisateurs pendant 60 s : 116 lots/s, ACK p50 8,7 ms, p95 26 ms, p99 226 ms, convergé. Le p99 est plus haut, probablement parce que la machine faisait tourner en même temps le navigateur, Vite et Node 20 — à re-mesurer en Node 22 (section 7)._

Au-delà de l'objectif, sur **un seul** board : 100 utilisateurs → ACK p50 115 ms ; 200 → 430 ms. Tout converge encore, mais la mesure est surtout limitée par le générateur : un seul processus Node fait tourner tous les clients.

### Robustesse

- **Convergence aléatoire** : 1 050 scénarios en vérification ponctuelle (21 en CI) ; reconnexion : 1 000 scénarios (30 en CI). Le tout à 2, 3, 5, 20 et 50 utilisateurs, avec :
  - ordre de livraison aléatoire, coupures réseau et enregistrement lent ;
  - déplacements verrouillés, tracés, renommages, suppressions, undo/redo.
- **Persistance** : redémarrer l'API ne perd aucun lot confirmé.
- **Test de charge** WebSocket à 50 utilisateurs : 20 exécutions sur 20 convergent.

## 4. Jalons

| Jalon | Objet | PR |
|---|---|---|
| M0.1 | Socle du monorepo | #1 |
| M0.2 | Moteur de rendu | #2 |
| M0.3 | Entrées et Apple Pencil | #3 |
| M0.4 | Modèle d'objets | #4 |
| M0.5 | Serveur temps réel | #5 |
| M0.6 | Persistance PostgreSQL | #6 |
| M0.7 | Verrous d'édition | #7 |
| M0.8 | Undo/redo individuel | #8 |
| M0.9 | Reconnexion et hors ligne | #9 |
| M0.10 | Audit log | #10 |
| M0.11 | Tests de collaboration | #11 |

## 5. Bugs trouvés par les tests — et corrigés

Les tests aléatoires et de charge ont joué leur rôle : chacun de ces bugs serait arrivé en production. Chacun a désormais un test de régression.

| Jalon | Bug | Effet en production |
|---|---|---|
| M0.6 | Un geste terminé sans lot restant n'était pas journalisé | Historique incomplet |
| M0.7 | Verrous renouvelés sur des objets supprimés | Verrous inutiles |
| M0.9 | Board déchargé pendant qu'un participant le rejoignait | Board « fantôme » vide |
| M0.9 | Resynchronisation perdue lors d'une coupure | Client désynchronisé |
| M0.9 | Lot déjà appliqué réappliqué après reconnexion | Retour en arrière d'un objet |
| M0.11 | Une transaction par lot | ACK à 340 ms à 50 utilisateurs (→ 8,5 ms) |
| M0.11 | Refus de verrou arrivé en retard | Objet bloqué 10 s pour rien |
| M0.11 | Lot diffusé en retard réappliqué sur un état plus récent | Objets ramenés en arrière (divergence) |
| M0.11 | Lots déjà inclus dans un état complet réappliqués | Modifications des autres écrasées (divergence) |

## 6. Limites connues

À traiter dans les phases suivantes ; aucune ne remet en cause l'architecture.

1. **Pas encore de comptes.** L'acteur journalisé et audité est un client anonyme (nom affiché dans les métadonnées). Ça arrive en **M1.1** ; l'endpoint d'audit est ouvert à tous en attendant **M1.2**.
2. **Historique d'undo perdu au rechargement de la page.** Il pourra être reconstruit depuis le journal une fois l'acteur devenu un utilisateur (M1.1).
3. **Une seule instance d'API.** Les verrous et la diffusion vivent en mémoire (décision D9 : pas de Redis en v1). L'interface `PubSub` est prête pour plusieurs instances.
4. **Resynchronisation coûteuse.** Elle renvoie l'état complet du board. C'est sans importance aux tailles testées, mais à surveiller sur de très gros boards (resynchronisation incrémentale possible).
5. **Perte locale rare.** Si une opération distante ne peut pas s'appliquer localement (état incohérent), le client abandonne ses modifications locales non encore envoyées avant de se resynchroniser. C'est devenu rare avec les corrections de M0.11, mais une notification à l'utilisateur serait préférable.
6. **Tests navigateur hors CI.** Les essais à plusieurs navigateurs (Playwright) ont été faits ponctuellement à chaque jalon, mais ne tournent pas en CI. **À ajouter en Phase 1.**
7. **Pas encore de build de production de l'API** (prévu en M1.10) ni de déploiement Docker Compose complet.
8. **Node 22 minimum** : ta machine est en Node 20 (voir section 7).

## 7. À valider par toi avant le GO

- [ ] **Collaboration PC ↔ iPad** : fiches M0.7 à M0.9 depuis l'iPad (verrou visible, undo individuel, mode Avion puis retour)
- [ ] **Audit** : fiche M0.10, une ligne par action
- [ ] **Charge** : relancer `pnpm load --users 20 --duration 60` en **Node 22**, sans navigateur ouvert, et me donner le p99
- [ ] **Décision** : GO / NO-GO pour la Phase 1 (M1.1 — authentification et comptes)

Une fois ces points validés : PR `dev` → `main` pour clôturer la Phase 0, puis démarrage de M1.1.
