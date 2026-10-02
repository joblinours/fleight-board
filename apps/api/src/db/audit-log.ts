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
