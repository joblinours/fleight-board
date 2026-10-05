/** Fiche de test d'un jalon, affichée sur la page d'accueil. */
export type Milestone = {
  id: string;
  title: string;
  /** Ce que le jalon apporte. */
  summary: string;
  /** Page de test (hash). */
  href: string;
  linkLabel: string;
  /** Étapes du test manuel. */
  steps: string[];
  /** Nécessite l'API (et PostgreSQL à partir de M0.6). */
  needsApi?: boolean;
  /** À ouvrir sur plusieurs appareils / navigateurs. */
  multiDevice?: boolean;
};

/**
 * Un jalon = une fiche. À compléter à chaque nouveau jalon (Mx.x) pour garder
 * un lien de test à jour depuis la page d'accueil.
 */
export const MILESTONES: Milestone[] = [
  {
    id: 'M0.1',
    title: 'Socle du monorepo',
    summary: 'API, WebSocket et healthchecks.',
    href: '#/',
    linkLabel: 'Cette page',
    needsApi: true,
    steps: ['L’encart « API » ci-dessus doit indiquer « prête ».'],
  },
  {
    id: 'M0.2',
    title: 'Moteur de rendu',
    summary: 'Canvas 2D, culling, zoom et pan sur des milliers d’objets.',
    href: '#/bench',
    linkLabel: 'Benchmark du rendu',
    steps: [
      'Choisir 5 000 objets puis « Lancer le benchmark (6 s) ».',
      'Relever FPS moyen, frame p95 et frames perdues (desktop et iPad).',
    ],
  },
  {
    id: 'M0.3',
    title: 'Stylet, tactile et Apple Pencil',
    summary: 'Pression, palm rejection, modes de saisie, pinch-zoom.',
    href: '#/ink',
    linkLabel: 'Dessin au stylet',
    steps: [
      'Tracer au Pencil, vite et lentement : épaisseur selon la pression.',
      'Écrire avec la paume posée : « Paumes ignorées » augmente, aucune trace.',
      'Pinch et pan à deux doigts ; essayer les trois modes.',
    ],
  },
  {
    id: 'M0.4',
    title: 'Objets et connecteurs',
    summary: 'Formes, texte, stylo, sélection, redimensionnement, connecteurs ancrés.',
    href: '#/board',
    linkLabel: 'Board local',
    steps: [
      '« Exemple » charge un schéma réseau ; déplacer un objet : ses connecteurs suivent.',
      'Créer un rectangle (R), double-cliquer pour le nommer, le relier (C) à un autre.',
      'Supprimer un objet relié : le connecteur garde son tracé.',
    ],
  },
  {
    id: 'M0.5',
    title: 'Collaboration temps réel',
    summary: 'Modifications synchronisées entre participants.',
    href: '#/board/test-m05',
    linkLabel: 'Board « test-m05 »',
    needsApi: true,
    multiDevice: true,
    steps: [
      'Ouvrir le même lien sur le PC et l’iPad : les deux noms apparaissent en bas à droite.',
      'Charger l’exemple sur l’un, déplacer et créer des objets sur l’autre : tout est synchronisé.',
    ],
  },
  {
    id: 'M0.6',
    title: 'Persistance PostgreSQL',
    summary: 'Les boards survivent au redémarrage de l’API.',
    href: '#/board/test-m06',
    linkLabel: 'Board « test-m06 »',
    needsApi: true,
    steps: [
      'Charger l’exemple, déplacer un objet, tracer au stylo.',
      'Arrêter puis relancer le projet (Ctrl+C, puis ./scripts/dev.sh).',
      'Recharger la page : tout est là, à l’identique.',
    ],
  },
  {
    id: 'M0.7',
    title: 'Verrous d’objets',
    summary: 'Un objet en cours de modification appartient à une seule personne.',
    href: '#/board/test-m07',
    linkLabel: 'Board « test-m07 »',
    needsApi: true,
    multiDevice: true,
    steps: [
      'Sur l’iPad, saisir un objet au Pencil et le garder appuyé.',
      'Sur le PC : l’objet affiche « ✎ Nom » et ne peut être ni déplacé ni supprimé.',
      'Relâcher sur l’iPad : l’objet redevient modifiable depuis le PC.',
    ],
  },
  {
    id: 'M0.8',
    title: 'Undo individuel',
    summary: 'Ctrl/⌘+Z n’annule que ses propres actions, sans écraser celles des autres.',
    href: '#/board/test-m08',
    linkLabel: 'Board « test-m08 »',
    needsApi: true,
    multiDevice: true,
    steps: [
      'Sur le PC : « Exemple », puis déplacer le Router.',
      'Sur l’iPad : double-tap sur le Router et le renommer.',
      'Sur le PC : Ctrl+Z (ou « Annuler ») — le Router revient à sa place et garde le nom donné sur l’iPad.',
      'Ctrl+Maj+Z (ou « Rétablir ») le redéplace.',
      'Supprimer sur l’iPad un objet déplacé sur le PC, puis Ctrl+Z sur le PC : message « Annulation impossible ».',
    ],
  },
  {
    id: 'M0.9',
    title: 'Reconnexion',
    summary: 'Coupure réseau : on continue en local, tout se resynchronise au retour.',
    href: '#/board/test-m09',
    linkLabel: 'Board « test-m09 »',
    needsApi: true,
    multiDevice: true,
    steps: [
      'Sur l’iPad : activer le mode Avion — l’encart indique « Hors ligne » et les modifications en attente.',
      'Sur l’iPad, hors ligne : déplacer des objets, dessiner, renommer le Switch.',
      'Sur le PC, pendant ce temps : renommer le Firewall et aussi le Switch.',
      'Couper le mode Avion : reconnexion automatique, les deux appareils affichent le même board.',
      'Le Switch garde le nom donné sur le PC (arrivé en premier) ; l’iPad affiche « 1 modification n’a pas pu être appliquée ».',
    ],
  },
  {
    id: 'M0.10',
    title: 'Audit log',
    summary: 'Chaque opération finale est tracée : auteur, action, objet, session, annulations.',
    href: '#/audit/test-m10',
    linkLabel: 'Audit de « test-m10 »',
    needsApi: true,
    steps: [
      'Depuis la page d’audit, « Ouvrir le board » (sur le PC ou l’iPad), puis « Exemple ».',
      'Déplacer le Router en un seul geste, tracer un trait au Stylo.',
      'Page d’audit : une ligne par action — « Modification » du router (x, y · geste), « Création » d’un stroke.',
      'Ctrl+Z puis Ctrl+Maj+Z (ou Annuler / Rétablir) : lignes marquées « annulation » puis « rétablissement ».',
      'Survoler un auteur affiche son identifiant client et sa session.',
    ],
  },
  {
    id: 'M0.11',
    title: 'Tests de charge',
    summary: '20 utilisateurs simulés sur le même board, à regarder et rejoindre en direct.',
    href: '#/board/test-m11',
    linkLabel: 'Board « test-m11 »',
    needsApi: true,
    steps: [
      'Ouvrir le board « test-m11 » (sur le PC ou l’iPad).',
      'Dans un terminal : pnpm load --users 20 --duration 60 --board test-m11',
      'Les 20 participants simulés apparaissent : déplacements (verrou à leur nom), tracés, renommages, suppressions.',
      'Déplacer ou renommer des objets en même temps qu’eux : tout reste fluide et cohérent.',
      'À la fin, le terminal affiche les latences et « convergé » ; « Recadrer » montre le même board partout.',
    ],
  },
  {
    id: 'M1.1',
    title: 'Comptes et connexion',
    summary: 'Connexion par mot de passe, sessions, demandes de compte, administration.',
    href: '#/admin',
    linkLabel: 'Administration',
    needsApi: true,
    multiDevice: true,
    steps: [
      'Se connecter avec l’Admin affiché par ./scripts/dev.sh (« Admin : admin / … »).',
      'Sur l’iPad : « Demander un compte » ; la connexion répond « en attente de validation ».',
      'Sur le PC, Administration : « Valider » la demande ; l’iPad peut alors se connecter.',
      'Ouvrir un board des deux côtés : chacun apparaît sous le nom de son compte.',
      'Sur le PC : « Désactiver » le compte de l’iPad → l’iPad est déconnecté et renvoyé à la connexion.',
      '« Réinitialiser le mot de passe » : l’iPad se connecte avec le mot de passe temporaire et doit le changer.',
      '5 mauvais mots de passe d’affilée bloquent le compte 15 minutes.',
    ],
  },
  {
    id: 'M1.2',
    title: 'Whiteboards',
    summary: 'Créer, lister, renommer, masquer, supprimer ses boards ; rejoindre par code.',
    href: '#/',
    linkLabel: 'Mes whiteboards (ci-dessus)',
    needsApi: true,
    multiDevice: true,
    steps: [
      'Sur le PC : « + Nouveau whiteboard », page de taille fixe A4 paysage → la page blanche s’affiche, le reste est grisé.',
      'Sur l’iPad (autre compte) : « Rejoindre un board » avec le code à 6 caractères affiché sur le PC.',
      'Créer aussi un board infini ; « Renommer », « Masquer » puis « Afficher les boards masqués ».',
      'Supprimer le board A4 pendant que l’iPad y est : l’iPad affiche « Ce board vient d’être supprimé ».',
      'Un ancien lien de test (ex. board « test-m05 ») propose « Créer ce board ».',
    ],
  },
  {
    id: 'M1.3',
    title: 'Objets complets',
    summary: 'Ligne, flèche, polygone, images, surligneur, gomme et panneau de propriétés.',
    href: '#/',
    linkLabel: 'Ouvrir un de mes boards (ci-dessus)',
    needsApi: true,
    multiDevice: true,
    steps: [
      'Polygone : un appui par sommet, puis appui sur le premier sommet pour fermer.',
      'Ligne et Flèche : glisser ; le panneau de gauche règle couleur, épaisseur, pointes et opacité.',
      'Surligneur au Pencil, puis Gomme sur un trait : seul le trait touché disparaît.',
      'Image : bouton « Image », glisser-déposer un fichier ou coller (Ctrl+V) ; l’iPad la voit aussi.',
      'Sélectionner une forme : remplissage « aucun », épaisseur, opacité ; Ctrl+Z annule le réglage d’un coup.',
    ],
  },
  {
    id: 'M1.4',
    title: 'Sélection, groupes, frames',
    summary:
      'Rectangle de sélection et lasso, copier/coller/dupliquer, groupes, premier/arrière-plan et frames.',
    href: '#/',
    linkLabel: 'Ouvrir un de mes boards (ci-dessus)',
    needsApi: true,
    multiDevice: true,
    steps: [
      'Glisser dans le vide pour sélectionner plusieurs objets ; outil Lasso (Q) pour entourer à main levée.',
      'Grouper (Ctrl+G ou bouton) : un appui sur un membre sélectionne et déplace tout le groupe.',
      'Copier (Ctrl+C), puis coller (Ctrl+V) dans un autre board ; Ctrl+D duplique.',
      'Frame (F) : tirer un cadre autour d’objets, puis la déplacer par son titre : le contenu suit.',
      'Double-tap sur le titre d’une frame pour le renommer ; Premier plan / Arrière-plan sur une forme.',
    ],
  },
  {
    id: 'M1.5',
    title: 'Connecteurs',
    summary:
      'Connecteurs orthogonaux avec routage simple, flèches, labels et reconnexion par glisser.',
    href: '#/',
    linkLabel: 'Ouvrir un de mes boards (ci-dessus)',
    needsApi: true,
    multiDevice: true,
    steps: [
      'Outil Connecteur (C) entre deux formes : le tracé part de l’ancrage et suit des coudes à angle droit.',
      'Déplacer une forme : le tracé se recalcule, chez l’autre participant aussi.',
      'Sélectionner le connecteur, glisser une extrémité vers une autre forme : il s’y raccroche.',
      'Double-tap sur le connecteur : saisir un label, affiché au milieu du tracé.',
      'Panneau : tracé Orthogonal / Droit, pointes de flèche au début et à la fin.',
    ],
  },
  {
    id: 'M1.6',
    title: 'Présence',
    summary:
      'Curseurs nommés et colorés, liste des participants, modes « Drawing only » / « Cursor visible ».',
    href: '#/',
    linkLabel: 'Ouvrir un de mes boards (ci-dessus)',
    needsApi: true,
    multiDevice: true,
    steps: [
      'Ouvrir le même board sur deux appareils : chacun voit le curseur de l’autre, avec son nom et sa couleur.',
      'La liste en bas à droite montre les participants, leur couleur et leur mode ; « (vous) » vous désigne.',
      'Passer en « Drawing only » : votre curseur disparaît chez l’autre, vos dessins restent visibles.',
      'Recharger la page : le mode choisi est conservé.',
      'Un objet en cours de modification est encadré à la couleur de son auteur.',
    ],
  },
  {
    id: 'M1.7',
    title: 'Permissions',
    summary:
      'Rôles Viewer < Editor < Presenter < Co-owner < Owner, gestion des membres, vérification serveur.',
    href: '#/',
    linkLabel: 'Ouvrir un de mes boards (ci-dessus)',
    needsApi: true,
    multiDevice: true,
    steps: [
      'Créer un second compte (page Admin), puis dans un board : « Membres » → ajouter ce compte en Viewer.',
      'Régler « Accès des autres utilisateurs » sur « Membres seulement ».',
      'Avec le second compte : le board apparaît dans sa liste (« partagé ») ; il s’ouvre en lecture seule.',
      'Le passer en Editor : ses outils apparaissent aussitôt, sans recharger.',
      'Le retirer : sa session se ferme (« plus accès ») ; un compte tiers ne peut pas ouvrir le board.',
    ],
  },
  {
    id: 'M1.8',
    title: 'Sessions, invités et accès',
    summary:
      'Sessions publiques ou privées, demandes d’accès en temps réel, invités sans compte, accès temporaires.',
    href: '#/',
    linkLabel: 'Ouvrir un de mes boards (ci-dessus)',
    needsApi: true,
    multiDevice: true,
    steps: [
      '« Membres » : passer le board en session privée et cocher « Accepter les invités ».',
      'Sur l’iPad, sans être connecté, ouvrir #/join/CODE : saisir un nom → « en attente d’acceptation ».',
      'Sur l’ordinateur, le bouton « 1 demande d’accès » apparaît : accepter en Editor pour 1 heure.',
      'L’iPad entre aussitôt dans le board ; le retirer dans « Membres » le déconnecte.',
      'Accès « tant que je suis connecté » : quitter le board ferme la session de l’invité.',
      'Taper 10 codes inexistants : le 11e est refusé quelques minutes (cooldown).',
    ],
  },
];
