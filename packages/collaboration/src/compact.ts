import type { Operation } from '@fleight/protocol';

/**
 * Fusionne une suite d'opérations en une suite équivalente plus courte :
 * mises à jour successives d'un même objet fusionnées, mise à jour d'un objet
 * créé dans la même suite intégrée à sa création.
 * L'ordre relatif des objets différents est conservé.
 */
export function compactOperations(operations: readonly Operation[]): Operation[] {
  const result: Operation[] = [];
  // Position dans `result` de la dernière opération par objet.
  const lastIndex = new Map<string, number>();

  for (const operation of operations) {
    const id = operation.kind === 'create' ? operation.object.id : operation.id;
    const index = lastIndex.get(id);
    const previous = index === undefined ? undefined : result[index];

    if (operation.kind === 'update' && previous) {
      if (previous.kind === 'update') {
        result[index as number] = {
          kind: 'update',
          id,
          patch: { ...previous.patch, ...operation.patch },
        };
        continue;
      }
      if (previous.kind === 'create') {
        const object: Record<string, unknown> = { ...previous.object };
        for (const [key, value] of Object.entries(operation.patch)) {
          // `null` retire la propriété (voir BoardDocument).
          if (value === null) delete object[key];
          else object[key] = value;
        }
        result[index as number] = { kind: 'create', object: object as typeof previous.object };
        continue;
      }
    }

    lastIndex.set(id, result.length);
    result.push(operation);
  }
  return result;
}

/** Identifiants des objets touchés par des opérations. */
export function touchedIds(operations: readonly Operation[]): Set<string> {
  const ids = new Set<string>();
  for (const operation of operations) {
    ids.add(operation.kind === 'create' ? operation.object.id : operation.id);
  }
  return ids;
}
