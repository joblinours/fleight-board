import type { AuditRecord } from '@fleight/protocol';
import { desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../database';
import { auditLogs } from './schema';

/** Lecture de l'audit. */
export type AuditLogReader = {
  /** Entrées d'un board, les plus récentes d'abord. */
  list(boardId: string, limit: number): Promise<AuditRecord[]>;
  /** Événements de compte et d'administration, les plus récents d'abord. */
  listAccounts(limit: number): Promise<AuditRecord[]>;
};

export class PostgresAuditLog implements AuditLogReader {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async list(boardId: string, limit: number): Promise<AuditRecord[]> {
    const rows = await this.#db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.boardId, boardId))
      .orderBy(desc(auditLogs.id))
      .limit(limit);
    return rows.map(toRecord);
  }

  async listAccounts(limit: number): Promise<AuditRecord[]> {
    const rows = await this.#db
      .select()
      .from(auditLogs)
      .where(isNull(auditLogs.boardId))
      .orderBy(desc(auditLogs.id))
      .limit(limit);
    return rows.map(toRecord);
  }
}

function toRecord({ createdAt, ...row }: typeof auditLogs.$inferSelect): AuditRecord {
  return { ...row, createdAt: createdAt.toISOString() };
}

/** Événement hors opérations de board (compte, administration, gestion des boards). */
export type AuditEvent = {
  actor: string;
  actorType: 'user' | 'client' | 'system';
  action: typeof auditLogs.$inferInsert.action;
  boardId?: string | null;
  objectId?: string | null;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeAuditEvent(db: Db, event: AuditEvent): Promise<void> {
  await db.insert(auditLogs).values({
    actor: event.actor,
    actorType: event.actorType,
    action: event.action,
    boardId: event.boardId ?? null,
    objectId: event.objectId ?? null,
    sessionId: event.sessionId ?? null,
    metadata: event.metadata ?? {},
  });
}
