# Changelog

Les versions suivent le [versionnage sémantique](https://semver.org/lang/fr/). Le détail des jalons et des décisions est dans [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## [0.1.0] — 2026-10-06 — Core MVP (Phase 1)

Première version utilisable de Fleight Board.

### Comptes et administration
- Authentification locale :
  - mots de passe hachés en Argon2id ;
  - sessions en cookie `HttpOnly` ;
  - blocage après échecs répétés et limitation des tentatives par IP.
- Rôles globaux User et Admin :
  - premier Admin créé au démarrage ;
  - demandes de compte validées par un Admin ;
  - mot de passe temporaire à changer à la première connexion.
- Page d'administration : comptes, rôles, désactivation, réinitialisation, activité récente.

### Whiteboards
- Canvas infini ou standard (formats de page), créés depuis le tableau de bord. On les rejoint par lien ou par code.
- Objets :
  - rectangles, ellipses, polygones et texte ;
  - dessin libre (stylo, surligneur, gomme) ;
  - images importées (glisser-déposer, coller) ;
  - frames.
- Connecteurs droits ou orthogonaux, avec pointes de flèche, labels et accrochage aux objets.
- Sélection (rectangle, lasso), groupes, premier plan / arrière-plan, duplication.
- Copier, couper et coller, y compris d'un board à l'autre.
- Panneau de propriétés : couleurs, remplissage, épaisseur, opacité, taille du texte.
- Annuler et rétablir individuels : chacun n'annule que ses propres actions.

### Collaboration
- Synchronisation temps réel par WebSocket, persistée dans PostgreSQL.
- Verrous temporaires sur les objets en cours de modification.
- Resynchronisation après une coupure réseau.
- Curseurs nommés à la couleur de chaque participant, liste des présents, mode « dessins seulement ».
- Permissions par board :
  - rôles Viewer, Editor, Presenter, Co-owner et Owner ;
  - vérification par le serveur ;
  - transfert de propriété.
- Sessions publiques ou privées :
  - demandes d'accès acceptées en direct ;
  - invités sans compte ;
  - accès permanents, temporaires, ou valables tant que la personne qui les a accordés est connectée ;
  - limitation des essais de codes.
- Audit complet et non annulable :
  - page filtrable, paginée et exportable en CSV ;
  - audit global pour les Admins.

### Interface
- Design system maison :
  - thème clair et sombre ;
  - barre latérale ;
  - tableau de bord avec onglets et recherche ;
  - menus, fenêtres et notifications.
- Interface tablette :
  - barre d'outils compacte, avec des familles d'outils dépliables ;
  - cibles tactiles de 44 px ;
  - panneau de propriétés repliable et mode « interface masquée » ;
  - portrait et paysage ;
  - Apple Pencil (modes Pencil seul, ou doigt qui dessine).
- Clavier, y compris le clavier externe de l'iPad :
  - raccourcis des outils et des actions ;
  - flèches pour déplacer la sélection ;
  - zoom au clavier ;
  - aide avec `?`.

### Déploiement
- Une image Docker : l'API sert aussi l'interface, ce qui fait un seul port.
- `docker-compose.yml` avec PostgreSQL.
- Migrations appliquées au démarrage.
- Logs JSON et healthchecks `/health` et `/ready`.
- Scripts de sauvegarde et de restauration.
- Guide d'installation avec Docker Compose et Portainer, derrière un reverse proxy HTTPS : [docs/deployment.md](docs/deployment.md).
- Image publiée sur `ghcr.io/joblinours/fleight-board`.

### Limites connues
- Pas encore de mode présentation, d'export, d'import PDF/SVG, de corbeille ni de MFA : prévus en Phase 2.
- Une seule instance de l'API : la collaboration est gérée en mémoire de ce processus.
- Image Docker pour amd64 uniquement.

## [0.0.0] — 2026-10-02 — Preuve de concept (Phase 0)

Preuve de concept technique : moteur de rendu du canvas, Apple Pencil, objets structurés, connecteurs, collaboration à plusieurs, verrous, annulation individuelle, persistance, reconnexion et audit. Voir le [rapport de fin de phase](docs/poc-report.md).
