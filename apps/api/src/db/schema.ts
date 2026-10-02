import type { AuditAction, AuditActorType, AuditMetadata } from '@fleight/collaboration';
import type { BoardObject, Operation } from '@fleight/protocol';
import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const boards = pgTable('boards', {
  id: text('id').primaryKey(),
  /** Séquence du dernier lot appliqué. */
  seq: bigint('seq', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** État courant des objets : un board se charge sans rejouer le journal. */
export const objects = pgTable(
  'objects',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    data: jsonb('data').$type<BoardObject>().notNull(),
    version: integer('version').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.boardId, table.id] })],
);

/** Journal append-only : effet net de chaque lot ou geste. */
export const operations = pgTable(
  'operations',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    actor: text('actor').notNull(),
    gestureId: text('gesture_id'),
    /** `undo` ou `redo` ; absent pour une action normale. */
    intent: text('intent').$type<'undo' | 'redo'>(),
    operations: jsonb('operations').$type<Operation[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.boardId, table.seq] }),
    index('operations_board_created_idx').on(table.boardId, table.createdAt),
  ],
);

/** Copies complètes périodiques (historique, restauration). */
export const snapshots = pgTable(
  'snapshots',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    objects: jsonb('objects').$type<BoardObject[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.boardId, table.seq] })],
);

/**
 * Audit : une entrée par opération finale (undo et redo compris).
 * Sans clé étrangère vers `boards` : l'audit survit à la suppression d'un board.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    actor: text('actor').notNull(),
    actorType: text('actor_type').$type<AuditActorType>().notNull(),
    action: text('action').$type<AuditAction>().notNull(),
    boardId: text('board_id').notNull(),
    objectId: text('object_id'),
    sessionId: text('session_id'),
    metadata: jsonb('metadata').$type<AuditMetadata>().notNull(),
  },
  (table) => [
    index('audit_logs_board_created_idx').on(table.boardId, table.createdAt),
    index('audit_logs_actor_created_idx').on(table.actor, table.createdAt),
  ],
);
