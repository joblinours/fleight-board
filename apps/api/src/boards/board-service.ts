import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  accessValid,
  type BoardAction,
  can,
  canAssign,
  canChangeRole,
  canManage,
  effectiveRole,
} from '@fleight/permissions';
import {
  type AccessDuration,
  type AccessRequest,
  type AccessRequestStatus,
  type AddMemberRequest,
  AddMemberRequestSchema,
  BOARD_CODE_ALPHABET,
  type BoardGuest,
  type BoardMember,
  type BoardMembersResponse,
  type BoardRole,
  type BoardSummary,
  type CreateBoardRequest,
  CreateBoardRequestSchema,
  type DecideAccessRequest,
  DecideAccessRequestSchema,
  type Guest,
  type GuestRole,
  type MemberRole,
  type UpdateBoardRequest,
} from '@fleight/protocol';
import { createId } from '@fleight/shared';
import { and, asc, count, desc, eq, gt, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Identity } from '../auth/auth-service';
import type { Db } from '../database';
import { writeAuditEvent } from '../db/audit-log';
import { accessRequests, boardMembers, boards, guests, users } from '../db/schema';

/** Erreur métier, traduite en réponse HTTP par les routes. */
export class BoardError extends Error {
  constructor(
    readonly code:
      | 'BOARD_NOT_FOUND'
      | 'ID_TAKEN'
      | 'FORBIDDEN'
      | 'USER_NOT_FOUND'
      | 'MEMBER_NOT_FOUND'
      | 'ALREADY_MEMBER'
      | 'REQUEST_NOT_FOUND'
      | 'GUESTS_NOT_ALLOWED'
      | 'INVALID_ROLE',
    message: string,
  ) {
    super(message);
  }
}

/** Code court aléatoire (alphabet sans caractères ambigus). */
export function generateBoardCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += BOARD_CODE_ALPHABET[randomInt(BOARD_CODE_ALPHABET.length)];
  return code;
}

type Row = {
  board: typeof boards.$inferSelect;
  ownerName: string | null;
  memberRole: MemberRole | null;
  memberExpiresAt: Date | null;
  memberWhileConnected: string | null;
};

/** Durée de vie d'un invité (cookie et accès), sauf accès plus court. */
export const GUEST_TTL_MS = 24 * 60 * 60 * 1000;

/** Limites d'un accès accordé pour une durée donnée. */
function accessLimits(
  duration: AccessDuration,
  grantedBy: string,
): { expiresAt: Date | null; whileConnected: string | null } {
  switch (duration.kind) {
    case 'permanent':
      return { expiresAt: null, whileConnected: null };
    case 'temporary':
      return { expiresAt: new Date(Date.now() + duration.minutes * 60_000), whileConnected: null };
    case 'while-connected':
      return { expiresAt: null, whileConnected: grantedBy };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Auteur d'un événement d'audit : compte, ou invité. */
type Actor = Identity | { guestId: string; displayName: string };

type BoardAuditAction =
  | 'board.create'
  | 'board.update'
  | 'board.delete'
  | 'board.transfer'
  | 'board.member.add'
  | 'board.member.update'
  | 'board.member.remove'
  | 'board.guest.join'
  | 'board.guest.remove'
  | 'board.access.request'
  | 'board.access.accept'
  | 'board.access.deny';

const FORBIDDEN_MESSAGES: Partial<Record<BoardAction, string>> = {
  'board.view': 'Ce board est réservé à ses membres',
  'board.settings': 'Réservé aux Co-owners et au propriétaire du board',
  'board.members': 'Réservé aux Co-owners et au propriétaire du board',
  'board.delete': 'Seul le propriétaire peut supprimer le board',
  'board.transfer': 'Seul le propriétaire peut transférer le board',
  'board.edit': 'Votre rôle ne permet pas de modifier ce board',
};

/**
 * Whiteboards et leurs membres. Chaque opération vérifie le rôle de
 * l'utilisateur sur le board (matrice de `@fleight/permissions`).
 */
export class BoardService {
  readonly #db: Db;
  /** Appelé après la suppression d'un board (participants à déconnecter). */
  onDeleted: ((boardId: string) => void | Promise<void>) | undefined;
  /** Appelé quand les droits sur un board changent (sessions ouvertes à réévaluer). */
  onAccessChanged: ((boardId: string) => void | Promise<void>) | undefined;
  /** Appelé quand les demandes d'accès en attente changent (Co-owners à prévenir). */
  onAccessRequests: ((boardId: string, pending: number) => void) | undefined;
  /**
   * Le compte est connecté au board (accès « tant qu'il est connecté ») ; branché
   * sur les sessions WebSocket par l'application.
   */
  isConnected: (boardId: string, userId: string) => boolean = () => false;

  constructor(db: Db) {
    this.#db = db;
  }

  async create(owner: Identity, request: CreateBoardRequest): Promise<BoardSummary> {
    const values = CreateBoardRequestSchema.parse(request);
    const id = values.id ?? createId();
    if (values.id && (await this.#find(owner.userId, eq(boards.id, values.id)))) {
      throw new BoardError('ID_TAKEN', 'Un board porte déjà cet identifiant');
    }
    // Collision de code improbable (30⁶ combinaisons) : on retente.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.#db.insert(boards).values({
          id,
          code: generateBoardCode(),
          name: values.name,
          description: values.description,
          canvas: values.canvas,
          ownerId: owner.userId,
        });
        break;
      } catch (error) {
        const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
        if (cause?.code === '23505' && cause.constraint_name === 'boards_code_idx' && attempt < 5) {
          continue;
        }
        if (cause?.code === '23505') {
          throw new BoardError('ID_TAKEN', 'Un board porte déjà cet identifiant');
        }
        throw error;
      }
    }
    await this.#audit(owner, 'board.create', id, { name: values.name, canvas: values.canvas });
    return this.get(owner, id);
  }

  /** Boards possédés ou partagés avec l'utilisateur, les plus récemment modifiés d'abord. */
  async list(identity: Identity, { includeHidden = false } = {}): Promise<BoardSummary[]> {
    const mine = or(eq(boards.ownerId, identity.userId), eq(boardMembers.userId, identity.userId));
    const rows = await this.#select(identity.userId)
      .where(includeHidden ? mine : and(mine, eq(boards.hidden, false)))
      .orderBy(desc(boards.updatedAt));
    return rows.map((row) => this.#summary(row, identity.userId));
  }

  /** Board visible par l'utilisateur (rôle Viewer au moins). */
  async get(identity: Identity, id: string): Promise<BoardSummary> {
    return (await this.#authorize(identity, eq(boards.id, id), 'board.view')).board;
  }

  /**
   * Board correspondant à un code. Sans accès (session privée), le board est
   * tout de même renvoyé (`role: null`) : l'utilisateur peut demander l'accès.
   */
  async byCode(identity: Identity, code: string): Promise<BoardSummary> {
    const row = await this.#find(identity.userId, eq(boards.code, code));
    if (!row) throw new BoardError('BOARD_NOT_FOUND', 'Aucun board ne correspond à ce code');
    return this.#summary(row, identity.userId);
  }

  /**
   * Rôle d'un utilisateur sur un board ; `undefined` : board absent ou aucun accès.
   * Sert aussi aux sessions WebSocket et aux imports.
   */
  async roleOf(userId: string, boardId: string): Promise<BoardRole | undefined> {
    const row = await this.#find(userId, eq(boards.id, boardId));
    return row ? (this.#summary(row, userId).role ?? undefined) : undefined;
  }

  async update(identity: Identity, id: string, changes: UpdateBoardRequest): Promise<BoardSummary> {
    await this.#authorize(identity, eq(boards.id, id), 'board.settings');
    const values: Partial<typeof boards.$inferInsert> = { updatedAt: new Date() };
    if (changes.name !== undefined) values.name = changes.name;
    if (changes.description !== undefined) values.description = changes.description;
    if (changes.hidden !== undefined) values.hidden = changes.hidden;
    if (changes.visibility !== undefined) values.visibility = changes.visibility;
    if (changes.defaultRole !== undefined) values.defaultRole = changes.defaultRole;
    if (changes.allowGuests !== undefined) values.allowGuests = changes.allowGuests;
    await this.#db.update(boards).set(values).where(eq(boards.id, id));
    await this.#audit(identity, 'board.update', id, { changes });
    const access = [changes.visibility, changes.defaultRole, changes.allowGuests];
    if (access.some((value) => value !== undefined)) await this.onAccessChanged?.(id);
    return this.get(identity, id);
  }

  /** Suppression immédiate (v1) : objets, journal, membres et copies disparaissent avec le board. */
  async delete(identity: Identity, id: string): Promise<void> {
    const { board } = await this.#authorize(identity, eq(boards.id, id), 'board.delete');
    await this.#db.delete(boards).where(eq(boards.id, id));
    // L'audit n'a pas de clé étrangère vers `boards` : la trace de la suppression reste.
    await this.#audit(identity, 'board.delete', id, { name: board.name, code: board.code });
    await this.onDeleted?.(id);
  }

  /** Lecture de l'audit d'un board : Co-owner et propriétaire, ou Admin. */
  async canReadAudit(identity: Identity, id: string): Promise<boolean> {
    if (identity.role === 'admin') return true;
    return can(await this.roleOf(identity.userId, id), 'board.audit');
  }

  /** Propriétaire, membres et accès des non-membres ; visible de tout participant. */
  async members(identity: Identity, id: string): Promise<BoardMembersResponse> {
    const { board, row } = await this.#authorize(identity, eq(boards.id, id), 'board.view');
    const [owner] = row.board.ownerId
      ? await this.#db
          .select({ userId: users.id, username: users.username, displayName: users.displayName })
          .from(users)
          .where(eq(users.id, row.board.ownerId))
      : [];
    const host = alias(users, 'host');
    const members = await this.#db
      .select({
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        role: boardMembers.role,
        createdAt: boardMembers.createdAt,
        expiresAt: boardMembers.expiresAt,
        hostId: host.id,
        hostName: host.displayName,
      })
      .from(boardMembers)
      .innerJoin(users, eq(users.id, boardMembers.userId))
      .leftJoin(host, eq(host.id, boardMembers.whileConnected))
      .where(eq(boardMembers.boardId, id))
      .orderBy(asc(boardMembers.createdAt));
    const guestRows = await this.#db
      .select({
        guestId: guests.id,
        displayName: guests.displayName,
        role: guests.role,
        createdAt: guests.createdAt,
        expiresAt: guests.expiresAt,
        hostId: host.id,
        hostName: host.displayName,
      })
      .from(guests)
      .leftJoin(host, eq(host.id, guests.whileConnected))
      .where(and(eq(guests.boardId, id), gt(guests.expiresAt, new Date())))
      .orderBy(asc(guests.createdAt));
    const limit = (row: {
      expiresAt: Date | null;
      hostId: string | null;
      hostName: string | null;
    }) => ({
      expiresAt: row.expiresAt?.toISOString() ?? null,
      whileConnected:
        row.hostId && row.hostName ? { userId: row.hostId, displayName: row.hostName } : null,
    });
    return {
      owner: owner ?? null,
      members: members.map(
        (member): BoardMember => ({
          userId: member.userId,
          username: member.username,
          displayName: member.displayName,
          role: member.role,
          createdAt: member.createdAt.toISOString(),
          ...limit(member),
        }),
      ),
      guests: guestRows.flatMap((guest): BoardGuest[] =>
        guest.role
          ? [
              {
                guestId: guest.guestId,
                displayName: guest.displayName,
                role: guest.role,
                createdAt: guest.createdAt.toISOString(),
                ...limit(guest),
              },
            ]
          : [],
      ),
      visibility: board.visibility,
      defaultRole: board.defaultRole,
      allowGuests: board.allowGuests,
      role: board.role as BoardRole,
    };
  }

  /** Ajoute un membre (par nom d'utilisateur ou e-mail), avec un rôle au plus égal au sien. */
  async addMember(identity: Identity, id: string, input: AddMemberRequest): Promise<void> {
    const request = AddMemberRequestSchema.parse(input);
    const { board } = await this.#authorize(identity, eq(boards.id, id), 'board.members');
    if (!canAssign(board.role, request.role)) {
      throw new BoardError('FORBIDDEN', 'Vous ne pouvez pas attribuer un rôle supérieur au vôtre');
    }
    const identifier = request.identifier.trim().toLowerCase();
    const [user] = await this.#db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(
        and(
          or(eq(users.username, identifier), eq(users.email, identifier)),
          eq(users.status, 'active'),
        ),
      )
      .limit(1);
    if (!user) throw new BoardError('USER_NOT_FOUND', 'Aucun compte actif ne correspond');
    if (user.id === board.ownerId) {
      throw new BoardError('ALREADY_MEMBER', 'Cet utilisateur est le propriétaire du board');
    }
    const inserted = await this.#db
      .insert(boardMembers)
      .values({
        boardId: id,
        userId: user.id,
        role: request.role,
        grantedBy: identity.userId,
        ...accessLimits(request.duration, identity.userId),
      })
      .onConflictDoNothing()
      .returning({ userId: boardMembers.userId });
    if (!inserted.length) {
      throw new BoardError('ALREADY_MEMBER', 'Cet utilisateur est déjà membre du board');
    }
    await this.#audit(identity, 'board.member.add', id, {
      member: user.id,
      memberName: user.displayName,
      role: request.role,
      duration: request.duration,
    });
    await this.onAccessChanged?.(id);
  }

  /** Change le rôle d'un membre : seulement un membre et un rôle au plus égaux au sien. */
  async updateMember(
    identity: Identity,
    id: string,
    userId: string,
    role: MemberRole,
  ): Promise<void> {
    const { board } = await this.#authorize(identity, eq(boards.id, id), 'board.members');
    const member = await this.#member(id, userId);
    if (!canChangeRole(board.role, member.role, role)) {
      throw new BoardError('FORBIDDEN', 'Vous ne pouvez pas attribuer un rôle supérieur au vôtre');
    }
    if (member.role === role) return;
    await this.#db
      .update(boardMembers)
      .set({ role, grantedBy: identity.userId, updatedAt: new Date() })
      .where(and(eq(boardMembers.boardId, id), eq(boardMembers.userId, userId)));
    await this.#audit(identity, 'board.member.update', id, {
      member: userId,
      from: member.role,
      to: role,
    });
    await this.onAccessChanged?.(id);
  }

  /** Retire un membre ; chacun peut aussi quitter un board dont il est membre. */
  async removeMember(identity: Identity, id: string, userId: string): Promise<void> {
    const self = userId === identity.userId;
    const { board } = await this.#authorize(
      identity,
      eq(boards.id, id),
      self ? 'board.view' : 'board.members',
    );
    const member = await this.#member(id, userId);
    if (!self && !canManage(board.role, member.role)) {
      throw new BoardError('FORBIDDEN', 'Vous ne pouvez pas retirer un membre de rôle supérieur');
    }
    await this.#db
      .delete(boardMembers)
      .where(and(eq(boardMembers.boardId, id), eq(boardMembers.userId, userId)));
    await this.#audit(identity, 'board.member.remove', id, { member: userId, role: member.role });
    await this.onAccessChanged?.(id);
  }

  /** Transfère la propriété à un membre ; l'ancien propriétaire devient Co-owner. */
  async transfer(identity: Identity, id: string, userId: string): Promise<BoardSummary> {
    await this.#authorize(identity, eq(boards.id, id), 'board.transfer');
    await this.#member(id, userId);
    await this.#db.transaction(async (tx) => {
      await tx
        .delete(boardMembers)
        .where(and(eq(boardMembers.boardId, id), eq(boardMembers.userId, userId)));
      await tx
        .insert(boardMembers)
        .values({ boardId: id, userId: identity.userId, role: 'co-owner', grantedBy: userId });
      await tx
        .update(boards)
        .set({ ownerId: userId, updatedAt: new Date() })
        .where(eq(boards.id, id));
    });
    await this.#audit(identity, 'board.transfer', id, { from: identity.userId, to: userId });
    await this.onAccessChanged?.(id);
    return this.get(identity, id);
  }

  // ---------------------------------------------------------------- demandes d'accès

  /**
   * Demande l'accès à une session privée (compte). Sans effet si l'utilisateur a
   * déjà accès ou qu'une demande est en attente ; les Co-owners en sont prévenus.
   */
  async requestAccess(identity: Identity, id: string): Promise<AccessRequestStatus> {
    const row = await this.#find(identity.userId, eq(boards.id, id));
    if (!row) throw new BoardError('BOARD_NOT_FOUND', 'Board introuvable');
    if (can(this.#summary(row, identity.userId).role, 'board.view')) return { status: 'granted' };
    if (await this.#pendingRequest(id, { userId: identity.userId })) return { status: 'pending' };
    await this.#db.insert(accessRequests).values({
      id: createId(),
      boardId: id,
      userId: identity.userId,
      displayName: identity.displayName,
    });
    await this.#audit(identity, 'board.access.request', id, {});
    await this.#notifyRequests(id);
    return { status: 'pending' };
  }

  /** État de sa propre demande d'accès (compte ou invité). */
  async requestStatus(
    requester: { userId: string } | { guestId: string },
    id: string,
  ): Promise<AccessRequestStatus> {
    const role =
      'userId' in requester
        ? await this.roleOf(requester.userId, id)
        : await this.guestRole(requester.guestId, id);
    if (can(role, 'board.view')) return { status: 'granted' };
    const [latest] = await this.#db
      .select({ status: accessRequests.status })
      .from(accessRequests)
      .where(
        and(
          eq(accessRequests.boardId, id),
          'userId' in requester
            ? eq(accessRequests.userId, requester.userId)
            : eq(accessRequests.guestId, requester.guestId),
        ),
      )
      .orderBy(desc(accessRequests.createdAt))
      .limit(1);
    // Une demande acceptée dont l'accès a expiré compte comme refusée.
    return { status: latest?.status === 'pending' ? 'pending' : 'denied' };
  }

  /** La connexion attend une décision (demande en attente) : salle d'attente du hub. */
  async awaitsAccess(id: string, requester: { userId: string } | { guestId: string }) {
    return !!(await this.#pendingRequest(id, requester));
  }

  /** Demandes en attente : Co-owners et propriétaire. */
  async listRequests(identity: Identity, id: string): Promise<AccessRequest[]> {
    await this.#authorize(identity, eq(boards.id, id), 'board.members');
    const rows = await this.#db
      .select({
        id: accessRequests.id,
        userId: accessRequests.userId,
        displayName: accessRequests.displayName,
        username: users.username,
        createdAt: accessRequests.createdAt,
      })
      .from(accessRequests)
      .leftJoin(users, eq(users.id, accessRequests.userId))
      .where(and(eq(accessRequests.boardId, id), eq(accessRequests.status, 'pending')))
      .orderBy(asc(accessRequests.createdAt));
    return rows.map((row) => ({
      id: row.id,
      kind: row.userId ? 'user' : 'guest',
      displayName: row.displayName,
      username: row.username,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Accepte (rôle au plus égal au sien, durée) ou refuse une demande. Un invité
   * reçoit au plus le rôle Editor. La connexion en attente est aussitôt prévenue.
   */
  async decide(
    identity: Identity,
    id: string,
    requestId: string,
    input: DecideAccessRequest,
  ): Promise<void> {
    const decision = DecideAccessRequestSchema.parse(input);
    const { board } = await this.#authorize(identity, eq(boards.id, id), 'board.members');
    const [request] = await this.#db
      .select()
      .from(accessRequests)
      .where(
        and(
          eq(accessRequests.id, requestId),
          eq(accessRequests.boardId, id),
          eq(accessRequests.status, 'pending'),
        ),
      )
      .limit(1);
    if (!request) throw new BoardError('REQUEST_NOT_FOUND', 'Demande introuvable ou déjà traitée');

    if (decision.decision === 'accept') {
      if (!canAssign(board.role, decision.role)) {
        throw new BoardError(
          'FORBIDDEN',
          'Vous ne pouvez pas attribuer un rôle supérieur au vôtre',
        );
      }
      const limits = accessLimits(decision.duration, identity.userId);
      if (request.userId) {
        await this.#db
          .insert(boardMembers)
          .values({
            boardId: id,
            userId: request.userId,
            role: decision.role,
            grantedBy: identity.userId,
            ...limits,
          })
          .onConflictDoUpdate({
            target: [boardMembers.boardId, boardMembers.userId],
            set: {
              role: decision.role,
              grantedBy: identity.userId,
              updatedAt: new Date(),
              ...limits,
            },
          });
      } else if (request.guestId) {
        if (decision.role !== 'viewer' && decision.role !== 'editor') {
          throw new BoardError('INVALID_ROLE', 'Un invité ne peut être que Viewer ou Editor');
        }
        const [guest] = await this.#db
          .select({ expiresAt: guests.expiresAt })
          .from(guests)
          .where(eq(guests.id, request.guestId));
        // L'accès d'un invité ne dépasse jamais la durée de vie de l'invité.
        const expiresAt =
          limits.expiresAt && guest && limits.expiresAt < guest.expiresAt
            ? limits.expiresAt
            : guest?.expiresAt;
        await this.#db
          .update(guests)
          .set({
            role: decision.role,
            whileConnected: limits.whileConnected,
            ...(expiresAt ? { expiresAt } : {}),
          })
          .where(eq(guests.id, request.guestId));
      }
    }
    await this.#db
      .update(accessRequests)
      .set({
        status: decision.decision === 'accept' ? 'granted' : 'denied',
        decidedBy: identity.userId,
        decidedAt: new Date(),
      })
      .where(eq(accessRequests.id, requestId));
    await this.#audit(
      identity,
      decision.decision === 'accept' ? 'board.access.accept' : 'board.access.deny',
      id,
      {
        requester: request.userId ?? request.guestId,
        requesterName: request.displayName,
        ...(decision.decision === 'accept'
          ? { role: decision.role, duration: decision.duration }
          : {}),
      },
    );
    await this.#notifyRequests(id);
    await this.onAccessChanged?.(id);
  }

  async #pendingRequest(id: string, requester: { userId: string } | { guestId: string }) {
    const [request] = await this.#db
      .select({ id: accessRequests.id })
      .from(accessRequests)
      .where(
        and(
          eq(accessRequests.boardId, id),
          eq(accessRequests.status, 'pending'),
          'userId' in requester
            ? eq(accessRequests.userId, requester.userId)
            : eq(accessRequests.guestId, requester.guestId),
        ),
      )
      .limit(1);
    return request;
  }

  async #notifyRequests(id: string): Promise<void> {
    if (!this.onAccessRequests) return;
    const [row] = await this.#db
      .select({ pending: count() })
      .from(accessRequests)
      .where(and(eq(accessRequests.boardId, id), eq(accessRequests.status, 'pending')));
    this.onAccessRequests(id, row?.pending ?? 0);
  }

  // ---------------------------------------------------------------- invités

  /**
   * Rejoint un board par son code, sans compte. Session publique : l'invité
   * entre avec le rôle par défaut ; privée : sa demande d'accès est envoyée.
   * Retourne le jeton du cookie (seul son hash est stocké).
   */
  async joinAsGuest(
    code: string,
    displayName: string,
  ): Promise<{ token: string; guest: Guest; board: BoardSummary; expiresAt: Date }> {
    const [board] = await this.#db.select().from(boards).where(eq(boards.code, code)).limit(1);
    if (!board) throw new BoardError('BOARD_NOT_FOUND', 'Aucun board ne correspond à ce code');
    if (!board.allowGuests) {
      throw new BoardError(
        'GUESTS_NOT_ALLOWED',
        'Ce board n’accepte pas les invités : connectez-vous',
      );
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + GUEST_TTL_MS);
    const role: GuestRole | null = board.visibility === 'public' ? board.defaultRole : null;
    const guestId = createId();
    await this.#db.insert(guests).values({
      id: guestId,
      boardId: board.id,
      displayName,
      tokenHash: hashToken(token),
      role,
      expiresAt,
    });
    const actor = { guestId, displayName };
    await this.#audit(actor, 'board.guest.join', board.id, { visibility: board.visibility });
    if (!role) {
      await this.#db.insert(accessRequests).values({
        id: createId(),
        boardId: board.id,
        guestId,
        displayName,
      });
      await this.#audit(actor, 'board.access.request', board.id, {});
      await this.#notifyRequests(board.id);
    }
    const guest = { id: guestId, displayName, boardId: board.id, role };
    return { token, guest, board: await this.guestBoard(guest), expiresAt };
  }

  /** Invité d'un jeton de cookie, s'il n'a pas expiré. */
  async authenticateGuest(token: string | undefined): Promise<Guest | undefined> {
    if (!token) return undefined;
    const [guest] = await this.#db
      .select()
      .from(guests)
      .where(and(eq(guests.tokenHash, hashToken(token)), gt(guests.expiresAt, new Date())))
      .limit(1);
    if (!guest) return undefined;
    return {
      id: guest.id,
      displayName: guest.displayName,
      boardId: guest.boardId,
      role: (await this.guestRole(guest.id, guest.boardId)) ?? null,
    };
  }

  /** Rôle d'un invité sur un board : le sien, s'il est valide et que le board accepte les invités. */
  async guestRole(guestId: string, boardId: string): Promise<GuestRole | undefined> {
    const [row] = await this.#db
      .select({ guest: guests, allowGuests: boards.allowGuests })
      .from(guests)
      .innerJoin(boards, eq(boards.id, guests.boardId))
      .where(and(eq(guests.id, guestId), eq(guests.boardId, boardId)))
      .limit(1);
    if (!row?.allowGuests || !row.guest.role) return undefined;
    const valid = accessValid(row.guest, {
      isConnected: (host) => this.isConnected(boardId, host),
    });
    return valid ? row.guest.role : undefined;
  }

  /** Board d'un invité, avec son rôle. */
  async guestBoard(guest: Guest): Promise<BoardSummary> {
    const [row] = await this.#select('').where(eq(boards.id, guest.boardId)).limit(1);
    if (!row) throw new BoardError('BOARD_NOT_FOUND', 'Board introuvable');
    return {
      ...summary(row, '', false),
      role: (await this.guestRole(guest.id, guest.boardId)) ?? null,
    };
  }

  /** Retire un invité (Co-owner) : son accès et sa session prennent fin. */
  async removeGuest(identity: Identity, id: string, guestId: string): Promise<void> {
    await this.#authorize(identity, eq(boards.id, id), 'board.members');
    const removed = await this.#db
      .delete(guests)
      .where(and(eq(guests.id, guestId), eq(guests.boardId, id)))
      .returning({ displayName: guests.displayName });
    if (!removed.length) throw new BoardError('MEMBER_NOT_FOUND', 'Invité introuvable');
    await this.#audit(identity, 'board.guest.remove', id, {
      guest: guestId,
      guestName: removed[0]?.displayName,
    });
    await this.#notifyRequests(id);
    await this.onAccessChanged?.(id);
  }

  async #member(boardId: string, userId: string): Promise<{ role: MemberRole }> {
    const [member] = await this.#db
      .select({ role: boardMembers.role })
      .from(boardMembers)
      .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)))
      .limit(1);
    if (!member) throw new BoardError('MEMBER_NOT_FOUND', 'Ce compte n’est pas membre du board');
    return member;
  }

  /** Board existant et action permise par le rôle de l'utilisateur, sinon erreur. */
  async #authorize(
    identity: Identity,
    condition: ReturnType<typeof eq>,
    action: BoardAction,
  ): Promise<{ board: BoardSummary; row: Row }> {
    const row = await this.#find(identity.userId, condition);
    if (!row) throw new BoardError('BOARD_NOT_FOUND', 'Board introuvable');
    const board = this.#summary(row, identity.userId);
    if (!can(board.role, action)) {
      throw new BoardError('FORBIDDEN', FORBIDDEN_MESSAGES[action] ?? 'Action non autorisée');
    }
    return { board, row };
  }

  /** Board, nom du propriétaire et rôle de membre de l'utilisateur. */
  #select(userId: string) {
    return this.#db
      .select({
        board: boards,
        ownerName: users.displayName,
        memberRole: boardMembers.role,
        memberExpiresAt: boardMembers.expiresAt,
        memberWhileConnected: boardMembers.whileConnected,
      })
      .from(boards)
      .leftJoin(users, eq(users.id, boards.ownerId))
      .leftJoin(
        boardMembers,
        and(eq(boardMembers.boardId, boards.id), eq(boardMembers.userId, userId)),
      );
  }

  async #find(userId: string, condition: ReturnType<typeof eq>): Promise<Row | undefined> {
    const [row] = await this.#select(userId).where(condition).limit(1);
    return row;
  }

  async #audit(
    actor: Actor,
    action: BoardAuditAction,
    boardId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const guest = 'guestId' in actor;
    await writeAuditEvent(this.#db, {
      actor: guest ? actor.guestId : actor.userId,
      actorType: guest ? 'guest' : 'user',
      action,
      boardId,
      sessionId: guest ? null : actor.sessionId,
      metadata: { actorName: actor.displayName, ...metadata },
    });
  }

  /** Résumé d'un board pour un utilisateur : rôle de membre pris en compte s'il est valide. */
  #summary(row: Row, userId: string): BoardSummary {
    const valid = accessValid(
      { expiresAt: row.memberExpiresAt, whileConnected: row.memberWhileConnected },
      { isConnected: (host) => this.isConnected(row.board.id, host) },
    );
    return summary(row, userId, valid);
  }
}

function summary(
  { board, ownerName, memberRole }: Row,
  userId: string,
  memberValid: boolean,
): BoardSummary {
  return {
    id: board.id,
    code: board.code,
    name: board.name,
    description: board.description,
    canvas: board.canvas,
    ownerId: board.ownerId,
    ownerName,
    hidden: board.hidden,
    visibility: board.visibility,
    defaultRole: board.defaultRole,
    allowGuests: board.allowGuests,
    role:
      effectiveRole({
        isOwner: board.ownerId === userId,
        memberRole: memberValid ? memberRole : null,
        visibility: board.visibility,
        defaultRole: board.defaultRole,
      }) ?? null,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
  };
}
