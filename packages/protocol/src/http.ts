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
]);
export type BoardAuditAction = z.infer<typeof BoardAuditActionSchema>;

/** Entrée d'audit renvoyée par l'API. */
export const AuditRecordSchema = z.object({
  id: z.number().int(),
  /** Date ISO 8601. */
  createdAt: z.string(),
  /** Utilisateur (ou client anonyme pour les entrées antérieures aux comptes). */
  actor: z.string(),
  actorType: z.enum(['client', 'user', 'system']),
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

export const AuditLogResponseSchema = z.object({ entries: z.array(AuditRecordSchema) });
export type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;
