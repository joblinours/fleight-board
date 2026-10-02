import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  protocolVersion: z.number().int().positive(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Entrée d'audit renvoyée par `GET /boards/:boardId/audit`. */
export const AuditRecordSchema = z.object({
  id: z.number().int(),
  /** Date ISO 8601. */
  createdAt: z.string(),
  actor: z.string(),
  actorType: z.enum(['client', 'user', 'system']),
  action: z.enum(['object.create', 'object.update', 'object.delete']),
  objectId: z.string().nullable(),
  sessionId: z.string().nullable(),
  metadata: z.object({
    seq: z.number().int(),
    actorName: z.string().optional(),
    gestureId: z.string().optional(),
    intent: z.enum(['undo', 'redo']).optional(),
    objectType: z.string().optional(),
    fields: z.array(z.string()).optional(),
  }),
});
export type AuditRecord = z.infer<typeof AuditRecordSchema>;

export const AuditLogResponseSchema = z.object({ entries: z.array(AuditRecordSchema) });
export type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;
