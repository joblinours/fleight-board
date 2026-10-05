import { z } from 'zod';
import { BoardObjectSchema, ObjectIdSchema } from './objects';
import { BoardRoleSchema } from './roles';

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

/**
 * Partage de la présence : « drawing » (Drawing only) ne montre que les dessins,
 * « cursor » (Cursor visible) montre aussi le curseur aux autres participants.
 */
export const PresenceModeSchema = z.enum(['drawing', 'cursor']);
export type PresenceMode = z.infer<typeof PresenceModeSchema>;

/** Palette des participants : chacun reçoit une couleur libre dans le board. */
export const PARTICIPANT_COLORS = [
  '#e11d48',
  '#2563eb',
  '#16a34a',
  '#ea580c',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#ca8a04',
  '#4f46e5',
  '#059669',
] as const;

export const ParticipantSchema = z.object({
  connectionId: z.string(),
  name: z.string(),
  /** Compte de l'utilisateur (absent sans authentification). */
  userId: z.string().optional(),
  /** Couleur attribuée par le serveur (curseur, verrous). */
  color: z.string(),
  mode: PresenceModeSchema,
  /** Rôle sur le board. */
  role: BoardRoleSchema,
  /** Invité sans compte. */
  guest: z.boolean().optional(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

// ---------------------------------------------------------------- client → serveur

export const JoinMessageSchema = z.object({
  type: z.literal('JOIN'),
  boardId: BoardIdSchema,
  /** Nom affiché (temporaire, avant l'authentification). */
  name: z.string().trim().min(1).max(40),
  /**
   * Identifiant stable du client pour la durée de la page : il survit aux
   * reconnexions (une connexion WebSocket, elle, change à chaque fois).
   */
  clientId: z.string().min(1).max(64),
  /** Mode de présence (conservé à travers les reconnexions). */
  mode: PresenceModeSchema.optional(),
});

export const LeaveMessageSchema = z.object({ type: z.literal('LEAVE') });

export const OperationsMessageSchema = z.object({
  type: z.literal('OPS'),
  /** Identifiant du lot choisi par le client (accusé de réception, idempotence). */
  batchId: z.string().min(1).max(64),
  operations: z.array(OperationSchema).min(1).max(MAX_OPERATIONS_PER_BATCH),
  gesture: GestureSchema.optional(),
  intent: IntentSchema.optional(),
  /**
   * Dernière séquence connue du client quand ces modifications ont été faites.
   * Une propriété modifiée par un autre client après cette séquence est en conflit :
   * le lot est refusé (cas typique : modifications faites hors connexion).
   */
  baseSeq: z.number().int().nonnegative(),
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

/** Position du curseur en coordonnées monde ; `null` : curseur hors du board. */
export const CursorPositionSchema = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .nullable();

/** Curseur de l'utilisateur, relayé aux autres participants en mode « cursor ». */
export const CursorMessageSchema = z.object({
  type: z.literal('CURSOR'),
  position: CursorPositionSchema,
});

/** Changement du mode de présence. */
export const PresenceModeMessageSchema = z.object({
  type: z.literal('PRESENCE_MODE'),
  mode: PresenceModeSchema,
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
  CursorMessageSchema,
  PresenceModeMessageSchema,
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
  /** Rôle de cette connexion sur le board. */
  role: BoardRoleSchema,
  snapshot: SnapshotSchema,
  participants: z.array(ParticipantSchema),
  locks: LockTableSchema,
  /**
   * Lots de ce client (même `clientId`) déjà appliqués : après une reconnexion,
   * leur effet est dans l'état transmis, le client ne doit ni les réappliquer ni les renvoyer.
   */
  applied: z.array(z.string()),
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
  /** Lot déjà appliqué auparavant (renvoyé après une reconnexion). */
  duplicate: z.boolean().optional(),
  seq: z.number().int().positive(),
  versions: z.record(z.string(), z.number().int().nonnegative()),
});

export const RejectMessageSchema = z.object({
  type: z.literal('REJECT'),
  batchId: z.string(),
  code: z.enum(['INVALID_OPERATION', 'NOT_JOINED', 'LOCKED', 'CONFLICT', 'FORBIDDEN']),
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

/** Participant modifié (mode de présence). */
export const ParticipantUpdatedSchema = z.object({
  type: z.literal('PARTICIPANT_UPDATED'),
  participant: ParticipantSchema,
});

/** Curseur d'un autre participant. */
export const RemoteCursorSchema = z.object({
  type: z.literal('CURSOR'),
  connectionId: z.string(),
  position: CursorPositionSchema,
});

/**
 * Session privée : l'accès a été demandé, la connexion attend la décision
 * (JOINED si elle est acceptée, fermeture 4403 si elle est refusée).
 */
export const AccessPendingSchema = z.object({ type: z.literal('ACCESS_PENDING') });

/** Aux Co-owners et au propriétaire : les demandes d'accès en attente ont changé. */
export const AccessRequestedSchema = z.object({
  type: z.literal('ACCESS_REQUESTED'),
  /** Nombre de demandes en attente. */
  pending: z.number().int().nonnegative(),
});

export const ServerSessionMessageSchema = z.discriminatedUnion('type', [
  AccessPendingSchema,
  AccessRequestedSchema,
  JoinedMessageSchema,
  SnapshotMessageSchema,
  RemoteOperationsMessageSchema,
  AckMessageSchema,
  RejectMessageSchema,
  ParticipantJoinedSchema,
  ParticipantLeftSchema,
  ParticipantUpdatedSchema,
  RemoteCursorSchema,
  LocksMessageSchema,
  LockDeniedSchema,
]);
export type ServerSessionMessage = z.infer<typeof ServerSessionMessageSchema>;
export type RemoteOperationsMessage = z.infer<typeof RemoteOperationsMessageSchema>;
export type AckMessage = z.infer<typeof AckMessageSchema>;
export type RejectMessage = z.infer<typeof RejectMessageSchema>;
