import { z } from 'zod';
import { BoardObjectSchema, ObjectIdSchema } from './objects';

/** Nombre maximal d'opérations dans un lot. */
export const MAX_OPERATIONS_PER_BATCH = 500;

export const BoardIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Identifiant de board invalide');

export const OperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), object: BoardObjectSchema }),
  z.object({
    kind: z.literal('update'),
    id: ObjectIdSchema,
    // Le contenu est validé en appliquant le patch à l'objet existant.
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({ kind: z.literal('delete'), id: ObjectIdSchema }),
]);
export type Operation = z.infer<typeof OperationSchema>;

/** Geste en cours (glisser, tracer) auquel un lot appartient. */
export const GestureSchema = z.object({
  id: z.string().min(1).max(64),
  /** Dernier lot du geste (pointer up). */
  final: z.boolean(),
});

/** Nature d'un lot : action normale, annulation ou rétablissement (journalisé pour l'audit). */
export const IntentSchema = z.enum(['undo', 'redo']);
export type Intent = z.infer<typeof IntentSchema>;

export const ParticipantSchema = z.object({
  connectionId: z.string(),
  name: z.string(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

// ---------------------------------------------------------------- client → serveur

export const JoinMessageSchema = z.object({
  type: z.literal('JOIN'),
  boardId: BoardIdSchema,
  /** Nom affiché (temporaire, avant l'authentification). */
  name: z.string().trim().min(1).max(40),
});

export const LeaveMessageSchema = z.object({ type: z.literal('LEAVE') });

export const OperationsMessageSchema = z.object({
  type: z.literal('OPS'),
  /** Identifiant du lot choisi par le client (accusé de réception, idempotence). */
  batchId: z.string().min(1).max(64),
  operations: z.array(OperationSchema).min(1).max(MAX_OPERATIONS_PER_BATCH),
  gesture: GestureSchema.optional(),
  intent: IntentSchema.optional(),
});

/** Fin d'un geste dont tous les lots ont déjà été envoyés. */
export const GestureEndSchema = z.object({
  type: z.literal('GESTURE_END'),
  gestureId: z.string().min(1).max(64),
});

const ObjectIdsSchema = z.array(ObjectIdSchema).min(1).max(MAX_OPERATIONS_PER_BATCH);

/**
 * Verrouillage temporaire d'objets avant de les modifier (glisser, redimensionner,
 * éditer un texte). Renouveler la demande prolonge le verrou.
 */
export const LockMessageSchema = z.object({ type: z.literal('LOCK'), objectIds: ObjectIdsSchema });
export const UnlockMessageSchema = z.object({
  type: z.literal('UNLOCK'),
  objectIds: ObjectIdsSchema,
});

/** Demande de l'état complet du board (après un rejet, par exemple). */
export const SyncRequestSchema = z.object({ type: z.literal('SYNC_REQUEST') });

export const ClientSessionMessageSchema = z.discriminatedUnion('type', [
  JoinMessageSchema,
  LeaveMessageSchema,
  OperationsMessageSchema,
  GestureEndSchema,
  LockMessageSchema,
  UnlockMessageSchema,
  SyncRequestSchema,
]);
export type ClientSessionMessage = z.infer<typeof ClientSessionMessageSchema>;
export type OperationsMessage = z.infer<typeof OperationsMessageSchema>;

// ---------------------------------------------------------------- serveur → client

/** État complet d'un board. */
export const SnapshotSchema = z.object({
  boardId: BoardIdSchema,
  /** Numéro de séquence de la dernière opération appliquée. */
  seq: z.number().int().nonnegative(),
  objects: z.array(BoardObjectSchema),
  /** Version de chaque objet (incrémentée à chaque modification). */
  versions: z.record(z.string(), z.number().int().nonnegative()),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

/** Verrous actifs : objet → connexion qui le détient. */
export const LockTableSchema = z.record(z.string(), z.string());

export const JoinedMessageSchema = z.object({
  type: z.literal('JOINED'),
  /** Identifiant de cette connexion (pour reconnaître ses propres verrous). */
  self: z.string(),
  snapshot: SnapshotSchema,
  participants: z.array(ParticipantSchema),
  locks: LockTableSchema,
});

/** Changement des verrous, diffusé à tous les participants (demandeur compris). */
export const LocksMessageSchema = z.object({
  type: z.literal('LOCKS'),
  locked: LockTableSchema,
  unlocked: z.array(z.string()),
});

/** Demande de verrou refusée : au moins un objet est détenu par une autre connexion. */
export const LockDeniedSchema = z.object({
  type: z.literal('LOCK_DENIED'),
  objectIds: z.array(z.string()),
  holder: z.string(),
});

export const SnapshotMessageSchema = z.object({
  type: z.literal('SNAPSHOT'),
  snapshot: SnapshotSchema,
});

/** Lot appliqué par le serveur, diffusé aux autres participants. */
export const RemoteOperationsMessageSchema = z.object({
  type: z.literal('OPS'),
  seq: z.number().int().positive(),
  actor: z.string(),
  operations: z.array(OperationSchema),
  versions: z.record(z.string(), z.number().int().nonnegative()),
  gesture: GestureSchema.optional(),
  intent: IntentSchema.optional(),
});

export const AckMessageSchema = z.object({
  type: z.literal('ACK'),
  batchId: z.string(),
  seq: z.number().int().positive(),
  versions: z.record(z.string(), z.number().int().nonnegative()),
});

export const RejectMessageSchema = z.object({
  type: z.literal('REJECT'),
  batchId: z.string(),
  code: z.enum(['INVALID_OPERATION', 'NOT_JOINED', 'LOCKED']),
  message: z.string(),
});

export const ParticipantJoinedSchema = z.object({
  type: z.literal('PARTICIPANT_JOINED'),
  participant: ParticipantSchema,
});

export const ParticipantLeftSchema = z.object({
  type: z.literal('PARTICIPANT_LEFT'),
  connectionId: z.string(),
});

export const ServerSessionMessageSchema = z.discriminatedUnion('type', [
  JoinedMessageSchema,
  SnapshotMessageSchema,
  RemoteOperationsMessageSchema,
  AckMessageSchema,
  RejectMessageSchema,
  ParticipantJoinedSchema,
  ParticipantLeftSchema,
  LocksMessageSchema,
  LockDeniedSchema,
]);
export type ServerSessionMessage = z.infer<typeof ServerSessionMessageSchema>;
export type RemoteOperationsMessage = z.infer<typeof RemoteOperationsMessageSchema>;
export type AckMessage = z.infer<typeof AckMessageSchema>;
export type RejectMessage = z.infer<typeof RejectMessageSchema>;
