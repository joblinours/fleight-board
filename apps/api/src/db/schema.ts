import type { AuditAction, AuditActorType } from '@fleight/collaboration';
import type {
  AccountAuditAction,
  BoardAuditAction,
  BoardCanvas,
  BoardObject,
  ImageMimeType,
  Operation,
} from '@fleight/protocol';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const boards = pgTable(
  'boards',
  {
    id: text('id').primaryKey(),
    /** Code court pour rejoindre le board (6 caractères, voir `BOARD_CODE_ALPHABET`). */
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    canvas: jsonb('canvas').$type<BoardCanvas>().notNull().default({ kind: 'infinite' }),
    /** Propriétaire ; absent si son compte a été supprimé (le board est conservé). */
    ownerId: text('owner_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    /** Masqué de la liste de son propriétaire. */
    hidden: boolean('hidden').notNull().default(false),
    /** Séquence du dernier lot appliqué. */
    seq: bigint('seq', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('boards_code_idx').on(table.code),
    index('boards_owner_idx').on(table.ownerId),
  ],
);

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
    action: text('action').$type<AuditAction | AccountAuditAction | BoardAuditAction>().notNull(),
    /** Absent pour les événements de compte (connexion, administration). */
    boardId: text('board_id'),
    objectId: text('object_id'),
    sessionId: text('session_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index('audit_logs_board_created_idx').on(table.boardId, table.createdAt),
    index('audit_logs_actor_created_idx').on(table.actor, table.createdAt),
  ],
);

export type UserRole = 'admin' | 'user';
/** `pending` : demande de compte en attente de validation par un Admin. */
export type UserStatus = 'active' | 'disabled' | 'pending';

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** En minuscules ; identifiant de connexion. */
    username: text('username').notNull(),
    /** En minuscules ; second identifiant de connexion, facultatif. */
    email: text('email'),
    displayName: text('display_name').notNull(),
    /** Argon2id (format PHC). */
    passwordHash: text('password_hash').notNull(),
    role: text('role').$type<UserRole>().notNull().default('user'),
    status: text('status').$type<UserStatus>().notNull().default('active'),
    /** Mot de passe temporaire (réinitialisé par un Admin) : à changer à la connexion. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    /** Protection brute force : échecs consécutifs et blocage temporaire. */
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_username_idx').on(table.username),
    uniqueIndex('users_email_idx').on(table.email),
  ],
);

/**
 * Sessions : seul le hash SHA-256 du jeton est stocké. Le jeton est renouvelé
 * périodiquement ; l'ancien reste accepté quelques secondes (requêtes en vol).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    previousTokenHash: text('previous_token_hash'),
    previousValidUntil: timestamp('previous_valid_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Dernier renouvellement du jeton. */
    rotatedAt: timestamp('rotated_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Expiration absolue (l'expiration d'inactivité se calcule sur `lastSeenAt`). */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (table) => [
    uniqueIndex('sessions_token_idx').on(table.tokenHash),
    index('sessions_previous_token_idx').on(table.previousTokenHash),
    index('sessions_user_idx').on(table.userId),
  ],
);

/**
 * Fichiers importés dans un board (images). Le contenu est dans le BlobStorage,
 * sous son empreinte SHA-256 : deux imports identiques ne sont stockés qu'une fois.
 */
export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    sha256: text('sha256').notNull(),
    mimeType: text('mime_type').$type<ImageMimeType>().notNull(),
    size: integer('size').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    uploadedBy: text('uploaded_by').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('assets_board_idx').on(table.boardId),
    index('assets_sha_idx').on(table.sha256),
  ],
);
