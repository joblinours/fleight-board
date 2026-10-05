import {
  BOARD_ROLES,
  type BoardRole,
  type BoardVisibility,
  type DefaultRole,
  type MemberRole,
} from '@fleight/protocol';

/** Rang d'un rôle : chaque rôle a tous les droits des rôles inférieurs. */
export function rank(role: BoardRole): number {
  return BOARD_ROLES.indexOf(role);
}

/** `a` est au moins aussi fort que `b`. */
export function atLeast(role: BoardRole, minimum: BoardRole): boolean {
  return rank(role) >= rank(minimum);
}

/**
 * Matrice des actions sur un whiteboard : rôle minimal requis pour chacune.
 * Le serveur vérifie chaque requête REST et chaque message WebSocket avec elle.
 */
export const BOARD_ACTIONS = {
  /** Ouvrir le board, voir son contenu et les participants, partager son curseur. */
  'board.view': 'viewer',
  /** Créer, modifier, supprimer des objets ; verrouiller ; importer des images. */
  'board.edit': 'editor',
  /** Présenter (suivi de la vue, Phase 2). */
  'board.present': 'presenter',
  /** Renommer, décrire, masquer, régler l'accès des non-membres. */
  'board.settings': 'co-owner',
  /** Ajouter, modifier, retirer des membres. */
  'board.members': 'co-owner',
  /** Lire l'audit du board. */
  'board.audit': 'co-owner',
  /** Supprimer le board. */
  'board.delete': 'owner',
  /** Transférer la propriété. */
  'board.transfer': 'owner',
} as const satisfies Record<string, BoardRole>;

export type BoardAction = keyof typeof BOARD_ACTIONS;

/** Le rôle autorise l'action. Sans rôle (aucun accès), rien n'est autorisé. */
export function can(role: BoardRole | undefined | null, action: BoardAction): boolean {
  return !!role && atLeast(role, BOARD_ACTIONS[action]);
}

/** Rôles attribuables à un membre, du plus faible au plus fort. */
export const MEMBER_ROLES: readonly MemberRole[] = ['viewer', 'editor', 'presenter', 'co-owner'];

/**
 * Rôles qu'un utilisateur peut attribuer : au plus le sien, jamais Owner (la
 * propriété se transfère). Un Owner — Admin global compris — délègue donc au
 * plus Co-owner.
 */
export function assignableRoles(actor: BoardRole | undefined | null): MemberRole[] {
  if (!can(actor, 'board.members')) return [];
  return MEMBER_ROLES.filter((role) => atLeast(actor as BoardRole, role));
}

/** L'utilisateur peut attribuer ce rôle à un nouveau membre. */
export function canAssign(actor: BoardRole | undefined | null, role: BoardRole): boolean {
  return role !== 'owner' && assignableRoles(actor).includes(role);
}

/**
 * L'utilisateur peut modifier ou retirer un membre de ce rôle : un rôle au plus
 * égal au sien, jamais l'Owner.
 */
export function canManage(actor: BoardRole | undefined | null, member: BoardRole): boolean {
  return member !== 'owner' && can(actor, 'board.members') && atLeast(actor as BoardRole, member);
}

/** L'utilisateur peut faire passer un membre du rôle `from` au rôle `to`. */
export function canChangeRole(
  actor: BoardRole | undefined | null,
  from: BoardRole,
  to: BoardRole,
): boolean {
  return canManage(actor, from) && canAssign(actor, to);
}

/**
 * Rôle effectif d'un utilisateur sur un board : propriétaire, sinon son rôle de
 * membre (accès encore valide), sinon le rôle par défaut d'une session publique ;
 * dans une session privée, un non-membre n'a aucun accès (il doit le demander).
 * Le rôle global (Admin) n'intervient pas : un Admin agit sur un board comme un User.
 */
export function effectiveRole(options: {
  isOwner: boolean;
  memberRole?: MemberRole | null | undefined;
  visibility: BoardVisibility;
  defaultRole: DefaultRole;
}): BoardRole | undefined {
  if (options.isOwner) return 'owner';
  if (options.memberRole) return options.memberRole;
  return options.visibility === 'public' ? options.defaultRole : undefined;
}

/**
 * Un accès accordé est-il encore valide : pas expiré, et la personne qui l'a
 * accordé « tant qu'elle est connectée » l'est toujours.
 */
export function accessValid(
  limit: { expiresAt: Date | null; whileConnected: string | null },
  { now = new Date(), isConnected }: { now?: Date; isConnected: (userId: string) => boolean },
): boolean {
  if (limit.expiresAt && limit.expiresAt.getTime() <= now.getTime()) return false;
  if (limit.whileConnected && !isConnected(limit.whileConnected)) return false;
  return true;
}

/** Libellés français des rôles (interface). */
export const ROLE_LABELS: Record<BoardRole, string> = {
  viewer: 'Viewer',
  editor: 'Editor',
  presenter: 'Presenter',
  'co-owner': 'Co-owner',
  owner: 'Owner',
};
