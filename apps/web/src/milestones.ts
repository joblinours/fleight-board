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
];
