import type { Intent, Operation } from '@fleight/protocol';
import type { JournalEntry } from './store';

/** Nature de l'auteur : client anonyme en Phase 0, utilisateur à partir de M1.1. */
export type AuditActorType = 'client' | 'user' | 'system';

export type AuditAction = 'object.create' | 'object.update' | 'object.delete';

/** Détails d'une entrée d'audit. */
export type AuditMetadata = {
  /** Séquence du lot (ou du dernier lot du geste) dans le journal. */
  seq: number;
  /** Nom affiché de l'auteur au moment de l'action. */
  actorName?: string;
  gestureId?: string;
  /** Annulation ou rétablissement. */
  intent?: Intent;
  /** Type de l'objet créé. */
  objectType?: string;
  /** Propriétés modifiées. */
  fields?: string[];
};

/** Une opération finale, telle qu'elle est conservée dans `audit_logs`. */
export type AuditEntry = {
  boardId: string;
  actor: string;
  actorType: AuditActorType;
  action: AuditAction;
  objectId: string;
  /** Connexion à l'origine de l'opération. */
  session?: string;
  metadata: AuditMetadata;
};

/**
 * Entrées d'audit d'une entrée du journal : une par opération finale.
 * Un geste étant journalisé par son effet net, un tracé ou un déplacement
 * produit une seule entrée par objet, quel que soit le nombre de lots.
 */
export function auditEntriesOf(boardId: string, entry: JournalEntry): AuditEntry[] {
  return entry.operations.map((operation) => ({
    boardId,
    actor: entry.actor,
    actorType: entry.actorType ?? 'client',
    action: ACTIONS[operation.kind],
    objectId: operation.kind === 'create' ? operation.object.id : operation.id,
    ...(entry.session ? { session: entry.session } : {}),
    metadata: {
      seq: entry.seq,
      ...(entry.actorName ? { actorName: entry.actorName } : {}),
      ...(entry.gestureId ? { gestureId: entry.gestureId } : {}),
      ...(entry.intent ? { intent: entry.intent } : {}),
      ...details(operation),
    },
  }));
}

const ACTIONS = {
  create: 'object.create',
  update: 'object.update',
  delete: 'object.delete',
} as const satisfies Record<Operation['kind'], AuditAction>;

function details(operation: Operation): Partial<AuditMetadata> {
  switch (operation.kind) {
    case 'create':
      return { objectType: operation.object.type };
    case 'update':
      return { fields: Object.keys(operation.patch).sort() };
    case 'delete':
      return {};
  }
}
