import type { AuditRecord } from '@fleight/protocol';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../database';
import { auditLogs } from './schema';

/** Lecture de l'audit d'un board. */
export type AuditLogReader = {
  /** Entrées les plus récentes d'abord. */
  list(boardId: string, limit: number): Promise<AuditRecord[]>;
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
    return rows.map(({ boardId: _boardId, createdAt, ...row }) => ({
      ...row,
      createdAt: createdAt.toISOString(),
    }));
  }
}
