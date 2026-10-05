import {
  AUDIT_CATEGORIES,
  type AuditCategory,
  type AuditLogResponse,
  type AuditRecord,
} from '@fleight/protocol';
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { Db } from '../database';
import { auditLogs } from './schema';

/** Filtres de l'audit (déjà validés par les routes). */
export type AuditFilter = {
  limit: number;
  /** Entrées d'identifiant strictement inférieur (page suivante). */
  before?: number | undefined;
  /** Un board ; ou, sans board : `accounts` (hors board), `boards` (tous les boards). */
  boardId?: string | undefined;
  scope?: 'all' | 'accounts' | 'boards' | undefined;
  category?: AuditCategory | undefined;
  actor?: string | undefined;
  /** Recherche dans le nom de l'auteur, son identifiant ou celui de l'objet. */
  q?: string | undefined;
  objectId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

/** Lecture de l'audit. */
export type AuditLogReader = {
  /** Entrées filtrées, les plus récentes d'abord, avec le curseur de la page suivante. */
  query(filter: AuditFilter): Promise<AuditLogResponse>;
};

export class PostgresAuditLog implements AuditLogReader {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async query(filter: AuditFilter): Promise<AuditLogResponse> {
    const conditions: SQL[] = [];
    if (filter.boardId !== undefined) conditions.push(eq(auditLogs.boardId, filter.boardId));
    else if (filter.scope === 'accounts') conditions.push(isNull(auditLogs.boardId));
    else if (filter.scope === 'boards') conditions.push(isNotNull(auditLogs.boardId));
    if (filter.before !== undefined) conditions.push(lt(auditLogs.id, filter.before));
    if (filter.category) {
      conditions.push(inArray(auditLogs.action, [...AUDIT_CATEGORIES[filter.category]]));
    }
    if (filter.actor) conditions.push(eq(auditLogs.actor, filter.actor));
    if (filter.objectId) conditions.push(eq(auditLogs.objectId, filter.objectId));
    if (filter.from) conditions.push(gte(auditLogs.createdAt, new Date(filter.from)));
    if (filter.to) conditions.push(lt(auditLogs.createdAt, new Date(filter.to)));
    if (filter.q) {
      // Les jokers de LIKE saisis sont pris littéralement.
      const pattern = `%${filter.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      const search = or(
        ilike(sql`${auditLogs.metadata}->>'actorName'`, pattern),
        ilike(auditLogs.actor, pattern),
        ilike(auditLogs.objectId, pattern),
      );
      if (search) conditions.push(search);
    }
    // Une entrée de plus que demandé : indique s'il reste une page.
    const rows = await this.#db
      .select()
      .from(auditLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.id))
      .limit(filter.limit + 1);
    const entries = rows.slice(0, filter.limit).map(toRecord);
    const last = entries.at(-1);
    return { entries, nextBefore: rows.length > filter.limit && last ? last.id : null };
  }
}

function toRecord({ createdAt, ...row }: typeof auditLogs.$inferSelect): AuditRecord {
  return { ...row, createdAt: createdAt.toISOString() };
}

/** Événement hors opérations de board (compte, administration, gestion des boards). */
export type AuditEvent = {
  actor: string;
  actorType: 'user' | 'guest' | 'client' | 'system';
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
