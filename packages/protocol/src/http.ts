import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  protocolVersion: z.number().int().positive(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Actions sur les objets d'un board. */
export const ObjectAuditActionSchema = z.enum(['object.create', 'object.update', 'object.delete']);

/** Événements de compte et d'administration (sans board). */
export const AccountAuditActionSchema = z.enum([
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.password_change',
  'user.request',
  'user.create',
  'user.update',
  'user.delete',
  'user.password_reset',
]);
export type AccountAuditAction = z.infer<typeof AccountAuditActionSchema>;

/** Gestion des boards (création, modification, suppression). */
export const BoardAuditActionSchema = z.enum([
  'board.create',
  'board.update',
  'board.delete',
  'board.transfer',
  'board.member.add',
  'board.member.update',
  'board.member.remove',
  'board.guest.join',
  'board.guest.remove',
  'board.access.request',
  'board.access.accept',
  'board.access.deny',
]);
export type BoardAuditAction = z.infer<typeof BoardAuditActionSchema>;

/** Entrée d'audit renvoyée par l'API. */
export const AuditRecordSchema = z.object({
  id: z.number().int(),
  /** Date ISO 8601. */
  createdAt: z.string(),
  /** Utilisateur (ou client anonyme pour les entrées antérieures aux comptes). */
  actor: z.string(),
  actorType: z.enum(['client', 'user', 'guest', 'system']),
  action: z.union([ObjectAuditActionSchema, AccountAuditActionSchema, BoardAuditActionSchema]),
  boardId: z.string().nullable(),
  /** Objet du board, ou utilisateur visé par un événement de compte. */
  objectId: z.string().nullable(),
  sessionId: z.string().nullable(),
  metadata: z
    .object({
      seq: z.number().int().optional(),
      actorName: z.string().optional(),
      gestureId: z.string().optional(),
      intent: z.enum(['undo', 'redo']).optional(),
      objectType: z.string().optional(),
      fields: z.array(z.string()).optional(),
    })
    .catchall(z.unknown()),
});
export type AuditRecord = z.infer<typeof AuditRecordSchema>;

export const AuditLogResponseSchema = z.object({
  entries: z.array(AuditRecordSchema),
  /** Curseur de la page suivante (entrées plus anciennes) ; `null` : fin de l'audit. */
  nextBefore: z.number().int().nullable().optional(),
});

/** Familles d'actions, pour filtrer l'audit. */
export const AUDIT_CATEGORIES = {
  /** Objets du board (création, modification, suppression ; undo et redo compris). */
  objects: ObjectAuditActionSchema.options,
  /** Le board lui-même : création, réglages, suppression, transfert. */
  board: ['board.create', 'board.update', 'board.delete', 'board.transfer'],
  /** Membres, invités et demandes d'accès. */
  access: [
    'board.member.add',
    'board.member.update',
    'board.member.remove',
    'board.guest.join',
    'board.guest.remove',
    'board.access.request',
    'board.access.accept',
    'board.access.deny',
  ],
  /** Comptes et administration (hors board). */
  accounts: AccountAuditActionSchema.options,
} as const satisfies Record<string, readonly AuditRecord['action'][]>;
export type AuditCategory = keyof typeof AUDIT_CATEGORIES;
export const AuditCategorySchema = z.enum(['objects', 'board', 'access', 'accounts']);

/** Date (`AAAA-MM-JJ`) ou instant ISO 8601. */
const AuditDateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Date invalide',
});

/**
 * Filtres de l'audit (paramètres de requête). Les entrées sont renvoyées de la
 * plus récente à la plus ancienne ; `before` pagine vers les plus anciennes.
 */
export const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  /** Entrées d'identifiant strictement inférieur (page suivante). */
  before: z.coerce.number().int().positive().optional(),
  category: AuditCategorySchema.optional(),
  /** Auteur exact (identifiant de compte, d'invité ou de client). */
  actor: z.string().min(1).max(64).optional(),
  /** Recherche dans le nom de l'auteur ou l'identifiant de l'objet. */
  q: z.string().trim().min(1).max(100).optional(),
  objectId: z.string().min(1).max(64).optional(),
  /** Depuis cet instant (inclus). */
  from: AuditDateSchema.optional(),
  /** Jusqu'à cet instant (exclu). */
  to: AuditDateSchema.optional(),
});
export type AuditQuery = z.input<typeof AuditQuerySchema>;

/** Audit global (Admin) : tous les boards et les comptes, ou une partie. */
export const AdminAuditQuerySchema = AuditQuerySchema.extend({
  /** `accounts` : événements hors board ; `boards` : événements de boards. */
  scope: z.enum(['all', 'accounts', 'boards']).default('all'),
  boardId: z.string().min(1).max(64).optional(),
});
export type AdminAuditQuery = z.input<typeof AdminAuditQuerySchema>;
export type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;
