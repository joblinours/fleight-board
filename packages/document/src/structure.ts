import type { BoardObject, Endpoint, FrameObject } from '@fleight/protocol';
import type { BoardDocument } from './document';
import { type Box, endpointPosition, objectBox } from './geometry';
import type { DocumentOperation } from './operations';

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Objets entièrement compris dans une frame (son contenu). */
export function frameContents(document: BoardDocument, frame: FrameObject): string[] {
  const ids: string[] = [];
  for (const object of document.all()) {
    if (object.id === frame.id) continue;
    const box = objectBox(document, object);
    if (box && contains(frame, box)) ids.push(object.id);
  }
  return ids;
}

/** Ajoute aux objets les autres membres de leurs groupes. */
export function expandGroups(document: BoardDocument, ids: Iterable<string>): Set<string> {
  const result = new Set(ids);
  const groups = new Set<string>();
  for (const id of result) {
    const groupId = document.get(id)?.groupId;
    if (groupId) groups.add(groupId);
  }
  if (!groups.size) return result;
  for (const object of document.all()) {
    if (object.groupId && groups.has(object.groupId)) result.add(object.id);
  }
  return result;
}

/** Objets à déplacer : la sélection, plus le contenu des frames sélectionnées. */
export function withFrameContents(document: BoardDocument, ids: Iterable<string>): Set<string> {
  const result = new Set(ids);
  for (const id of [...result]) {
    const object = document.get(id);
    if (object?.type === 'frame')
      for (const inner of frameContents(document, object)) result.add(inner);
  }
  return result;
}

/**
 * Copie d'objets, détachée du document : une extrémité de connecteur accrochée à
 * un objet non copié devient un point libre à sa position actuelle.
 */
export function copyObjects(document: BoardDocument, ids: Iterable<string>): BoardObject[] {
  const selected = new Set(ids);
  const copies: BoardObject[] = [];
  for (const id of selected) {
    const object = document.get(id);
    if (!object) continue;
    const copy = clone(object);
    if (copy.type === 'connector') {
      for (const key of ['start', 'end'] as const) {
        const endpoint = copy[key];
        if (endpoint.kind === 'object' && !selected.has(endpoint.objectId)) {
          const position = endpointPosition(document, endpoint);
          if (!position) continue;
          copy[key] = { kind: 'point', x: position.x, y: position.y };
        }
      }
    }
    copies.push(copy);
  }
  return copies.sort((a, b) => a.zIndex - b.zIndex);
}

/**
 * Création de copies collées : nouveaux identifiants (objets et groupes),
 * décalage, au-dessus de tout, ordre relatif conservé.
 */
export function pasteOperations(
  objects: readonly BoardObject[],
  options: { createId: () => string; offset: number; zIndexStart: number },
): { operations: DocumentOperation[]; ids: string[] } {
  const ids = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const object of objects) ids.set(object.id, options.createId());
  const { offset } = options;
  const shift = (endpoint: Endpoint): Endpoint => {
    if (endpoint.kind === 'point') {
      return { kind: 'point', x: endpoint.x + offset, y: endpoint.y + offset };
    }
    const target = ids.get(endpoint.objectId);
    return target ? { ...endpoint, objectId: target } : endpoint;
  };

  const operations: DocumentOperation[] = [...objects]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((object, index) => {
      const copy = clone(object) as BoardObject;
      copy.id = ids.get(object.id) as string;
      copy.zIndex = options.zIndexStart + index;
      if (object.groupId) {
        if (!groups.has(object.groupId)) groups.set(object.groupId, options.createId());
        copy.groupId = groups.get(object.groupId) as string;
      }
      if (copy.type === 'connector') {
        copy.start = shift(copy.start);
        copy.end = shift(copy.end);
      } else {
        copy.x += offset;
        copy.y += offset;
      }
      return { kind: 'create' as const, object: copy };
    });
  return { operations, ids: [...ids.values()] };
}

/** Met des objets au premier plan ou à l'arrière-plan, sans changer leur ordre relatif. */
export function zOrderOperations(
  document: BoardDocument,
  ids: Iterable<string>,
  position: 'front' | 'back',
): DocumentOperation[] {
  const selected = [...ids]
    .map((id) => document.get(id))
    .filter((object): object is BoardObject => object !== undefined)
    .sort((a, b) => a.zIndex - b.zIndex);
  if (!selected.length) return [];
  let bottom = Number.POSITIVE_INFINITY;
  for (const object of document.all()) bottom = Math.min(bottom, object.zIndex);
  const start = position === 'front' ? document.topZIndex() + 1 : bottom - selected.length;
  return selected.map((object, index) => ({
    kind: 'update' as const,
    id: object.id,
    patch: { zIndex: start + index },
  }));
}

/** Regroupe des objets sous un nouveau groupe (les groupes existants sont fusionnés). */
export function groupOperations(ids: Iterable<string>, groupId: string): DocumentOperation[] {
  return [...ids].map((id) => ({ kind: 'update' as const, id, patch: { groupId } }));
}

/** Défait les groupes des objets. */
export function ungroupOperations(
  document: BoardDocument,
  ids: Iterable<string>,
): DocumentOperation[] {
  return [...ids]
    .filter((id) => document.get(id)?.groupId)
    .map((id) => ({ kind: 'update' as const, id, patch: { groupId: null } }));
}

/** Copie profonde (objets JSON). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
