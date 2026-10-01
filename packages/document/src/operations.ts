import type { BoardObject } from '@fleight/protocol';

/** Modification partielle d'un objet ; `id` et `type` ne changent jamais. */
export type ObjectPatch = Partial<Omit<BoardObject, 'id' | 'type'>> & Record<string, unknown>;

export type DocumentOperation =
  | { kind: 'create'; object: BoardObject }
  | { kind: 'update'; id: string; patch: ObjectPatch }
  | { kind: 'delete'; id: string };
