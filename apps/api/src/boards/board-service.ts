import { randomInt } from 'node:crypto';
import {
  BOARD_CODE_ALPHABET,
  type BoardSummary,
  type CreateBoardRequest,
  CreateBoardRequestSchema,
  type UpdateBoardRequest,
} from '@fleight/protocol';
import { createId } from '@fleight/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Identity } from '../auth/auth-service';
import type { Db } from '../database';
import { writeAuditEvent } from '../db/audit-log';
import { boards, users } from '../db/schema';

/** Erreur métier, traduite en réponse HTTP par les routes. */
export class BoardError extends Error {
  constructor(
    readonly code: 'BOARD_NOT_FOUND' | 'ID_TAKEN' | 'FORBIDDEN',
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

type Row = { board: typeof boards.$inferSelect; ownerName: string | null };

/**
 * Création, liste et gestion des whiteboards. Jusqu'aux permissions (M1.7),
 * seul le propriétaire modifie ou supprime un board ; tout utilisateur connecté
 * peut l'ouvrir s'il en connaît le lien ou le code.
 */
export class BoardService {
  readonly #db: Db;
  /** Appelé après la suppression d'un board (participants à déconnecter). */
  onDeleted: ((boardId: string) => void | Promise<void>) | undefined;

  constructor(db: Db) {
    this.#db = db;
  }

  async create(owner: Identity, request: CreateBoardRequest): Promise<BoardSummary> {
    const values = CreateBoardRequestSchema.parse(request);
    const id = values.id ?? createId();
    if (values.id && (await this.#find(eq(boards.id, values.id)))) {
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
    return this.get(id);
  }

  /** Boards de l'utilisateur, les plus récemment modifiés d'abord. */
  async list(owner: Identity, { includeHidden = false } = {}): Promise<BoardSummary[]> {
    const rows = await this.#select()
      .where(
        includeHidden
          ? eq(boards.ownerId, owner.userId)
          : and(eq(boards.ownerId, owner.userId), eq(boards.hidden, false)),
      )
      .orderBy(desc(boards.updatedAt));
    return rows.map(summary);
  }

  async get(id: string): Promise<BoardSummary> {
    const row = await this.#find(eq(boards.id, id));
    if (!row) throw new BoardError('BOARD_NOT_FOUND', 'Board introuvable');
    return summary(row);
  }

  async byCode(code: string): Promise<BoardSummary> {
    const row = await this.#find(eq(boards.code, code));
    if (!row) throw new BoardError('BOARD_NOT_FOUND', 'Aucun board ne correspond à ce code');
    return summary(row);
  }

  async update(identity: Identity, id: string, changes: UpdateBoardRequest): Promise<BoardSummary> {
    await this.#owned(identity, id);
    const values: Partial<typeof boards.$inferInsert> = { updatedAt: new Date() };
    if (changes.name !== undefined) values.name = changes.name;
    if (changes.description !== undefined) values.description = changes.description;
    if (changes.hidden !== undefined) values.hidden = changes.hidden;
    await this.#db.update(boards).set(values).where(eq(boards.id, id));
    await this.#audit(identity, 'board.update', id, { changes });
    return this.get(id);
  }

  /** Suppression immédiate (v1) : objets, journal et copies disparaissent avec le board. */
  async delete(identity: Identity, id: string): Promise<void> {
    const board = await this.#owned(identity, id);
    await this.#db.delete(boards).where(eq(boards.id, id));
    // L'audit n'a pas de clé étrangère vers `boards` : la trace de la suppression reste.
    await this.#audit(identity, 'board.delete', id, { name: board.name, code: board.code });
    await this.onDeleted?.(id);
  }

  /** Lecture de l'audit d'un board : son propriétaire ou un Admin. */
  async canReadAudit(identity: Identity, id: string): Promise<boolean> {
    if (identity.role === 'admin') return true;
    const row = await this.#find(eq(boards.id, id));
    return row?.board.ownerId === identity.userId;
  }

  async #owned(identity: Identity, id: string): Promise<BoardSummary> {
    const board = await this.get(id);
    if (board.ownerId !== identity.userId) {
      throw new BoardError('FORBIDDEN', 'Seul le propriétaire du board peut le modifier');
    }
    return board;
  }

  #select() {
    return this.#db
      .select({ board: boards, ownerName: users.displayName })
      .from(boards)
      .leftJoin(users, eq(users.id, boards.ownerId));
  }

  async #find(condition: ReturnType<typeof eq>): Promise<Row | undefined> {
    const [row] = await this.#select().where(condition).limit(1);
    return row;
  }

  async #audit(
    identity: Identity,
    action: 'board.create' | 'board.update' | 'board.delete',
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

function summary({ board, ownerName }: Row): BoardSummary {
  return {
    id: board.id,
    code: board.code,
    name: board.name,
    description: board.description,
    canvas: board.canvas,
    ownerId: board.ownerId,
    ownerName,
    hidden: board.hidden,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
  };
}
