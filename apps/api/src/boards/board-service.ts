import { randomInt } from 'node:crypto';
import {
  type BoardAction,
  can,
  canAssign,
  canChangeRole,
  canManage,
  effectiveRole,
} from '@fleight/permissions';
import {
  type AddMemberRequest,
  BOARD_CODE_ALPHABET,
  type BoardMember,
  type BoardMembersResponse,
  type BoardRole,
  type BoardSummary,
  type CreateBoardRequest,
  CreateBoardRequestSchema,
  type MemberRole,
  type UpdateBoardRequest,
} from '@fleight/protocol';
import { createId } from '@fleight/shared';
import { and, asc, desc, eq, or } from 'drizzle-orm';
import type { Identity } from '../auth/auth-service';
import type { Db } from '../database';
import { writeAuditEvent } from '../db/audit-log';
import { boardMembers, boards, users } from '../db/schema';

/** Erreur métier, traduite en réponse HTTP par les routes. */
export class BoardError extends Error {
  constructor(
    readonly code:
      | 'BOARD_NOT_FOUND'
      | 'ID_TAKEN'
      | 'FORBIDDEN'
      | 'USER_NOT_FOUND'
      | 'MEMBER_NOT_FOUND'
      | 'ALREADY_MEMBER',
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
};

type BoardAuditAction =
  | 'board.create'
  | 'board.update'
  | 'board.delete'
  | 'board.transfer'
  | 'board.member.add'
  | 'board.member.update'
  | 'board.member.remove';

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
    return rows.map((row) => summary(row, identity.userId));
  }

  /** Board visible par l'utilisateur (rôle Viewer au moins). */
  async get(identity: Identity, id: string): Promise<BoardSummary> {
    return (await this.#authorize(identity, eq(boards.id, id), 'board.view')).board;
  }

  async byCode(identity: Identity, code: string): Promise<BoardSummary> {
    const row = await this.#find(identity.userId, eq(boards.code, code));
    if (!row) throw new BoardError('BOARD_NOT_FOUND', 'Aucun board ne correspond à ce code');
    const board = summary(row, identity.userId);
    if (!can(board.role, 'board.view')) {
      throw new BoardError('FORBIDDEN', 'Ce board est réservé à ses membres');
    }
    return board;
  }

  /**
   * Rôle d'un utilisateur sur un board ; `undefined` : board absent ou aucun accès.
   * Sert aussi aux sessions WebSocket et aux imports.
   */
  async roleOf(userId: string, boardId: string): Promise<BoardRole | undefined> {
    const row = await this.#find(userId, eq(boards.id, boardId));
    return row ? (summary(row, userId).role ?? undefined) : undefined;
  }

  async update(identity: Identity, id: string, changes: UpdateBoardRequest): Promise<BoardSummary> {
    await this.#authorize(identity, eq(boards.id, id), 'board.settings');
    const values: Partial<typeof boards.$inferInsert> = { updatedAt: new Date() };
    if (changes.name !== undefined) values.name = changes.name;
    if (changes.description !== undefined) values.description = changes.description;
    if (changes.hidden !== undefined) values.hidden = changes.hidden;
    if (changes.defaultRole !== undefined) values.defaultRole = changes.defaultRole;
    await this.#db.update(boards).set(values).where(eq(boards.id, id));
    await this.#audit(identity, 'board.update', id, { changes });
    if (changes.defaultRole !== undefined) await this.onAccessChanged?.(id);
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
    const members = await this.#db
      .select({
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        role: boardMembers.role,
        createdAt: boardMembers.createdAt,
      })
      .from(boardMembers)
      .innerJoin(users, eq(users.id, boardMembers.userId))
      .where(eq(boardMembers.boardId, id))
      .orderBy(asc(boardMembers.createdAt));
    return {
      owner: owner ?? null,
      members: members.map(
        (member): BoardMember => ({ ...member, createdAt: member.createdAt.toISOString() }),
      ),
      defaultRole: board.defaultRole,
      role: board.role as BoardRole,
    };
  }

  /** Ajoute un membre (par nom d'utilisateur ou e-mail), avec un rôle au plus égal au sien. */
  async addMember(identity: Identity, id: string, request: AddMemberRequest): Promise<void> {
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
      .values({ boardId: id, userId: user.id, role: request.role, grantedBy: identity.userId })
      .onConflictDoNothing()
      .returning({ userId: boardMembers.userId });
    if (!inserted.length) {
      throw new BoardError('ALREADY_MEMBER', 'Cet utilisateur est déjà membre du board');
    }
    await this.#audit(identity, 'board.member.add', id, {
      member: user.id,
      memberName: user.displayName,
      role: request.role,
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
    const board = summary(row, identity.userId);
    if (!can(board.role, action)) {
      throw new BoardError('FORBIDDEN', FORBIDDEN_MESSAGES[action] ?? 'Action non autorisée');
    }
    return { board, row };
  }

  /** Board, nom du propriétaire et rôle de membre de l'utilisateur. */
  #select(userId: string) {
    return this.#db
      .select({ board: boards, ownerName: users.displayName, memberRole: boardMembers.role })
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
    identity: Identity,
    action: BoardAuditAction,
    boardId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditEvent(this.#db, {
      actor: identity.userId,
      actorType: 'user',
      action,
      boardId,
      sessionId: identity.sessionId,
      metadata: { actorName: identity.displayName, ...metadata },
    });
  }
}

function summary({ board, ownerName, memberRole }: Row, userId: string): BoardSummary {
  return {
    id: board.id,
    code: board.code,
    name: board.name,
    description: board.description,
    canvas: board.canvas,
    ownerId: board.ownerId,
    ownerName,
    hidden: board.hidden,
    defaultRole: board.defaultRole,
    role:
      effectiveRole({
        isOwner: board.ownerId === userId,
        memberRole,
        defaultRole: board.defaultRole,
      }) ?? null,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
  };
}
