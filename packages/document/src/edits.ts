import type { BoardObject, StrokeObject } from '@fleight/protocol';
import type { BoardDocument } from './document';
import { type Box, endpointPosition } from './geometry';
import type { DocumentOperation, ObjectPatch } from './operations';

/**
 * Opérations de suppression d'objets. Les connecteurs accrochés à un objet supprimé
 * (et non supprimés eux-mêmes) gardent leur tracé : l'extrémité devient un point libre.
 */
export function deleteObjectsOperations(
  document: BoardDocument,
  ids: Iterable<string>,
): DocumentOperation[] {
  const deleted = new Set([...ids].filter((id) => document.has(id)));
  const detach: DocumentOperation[] = [];

  for (const id of deleted) {
    for (const connectorId of document.connectorsOf(id)) {
      if (deleted.has(connectorId)) continue;
      const connector = document.get(connectorId);
      if (connector?.type !== 'connector') continue;
      const patch: ObjectPatch = {};
      for (const key of ['start', 'end'] as const) {
        const endpoint = connector[key];
        if (endpoint.kind === 'object' && deleted.has(endpoint.objectId)) {
          const position = endpointPosition(document, endpoint);
          if (position) patch[key] = { kind: 'point', ...position };
        }
      }
      detach.push({ kind: 'update', id: connectorId, patch });
    }
  }

  return [...mergeUpdates(detach), ...[...deleted].map((id) => ({ kind: 'delete' as const, id }))];
}

/** Déplacement d'objets ; les extrémités libres des connecteurs déplacés suivent. */
export function moveObjectsOperations(
  document: BoardDocument,
  ids: Iterable<string>,
  dx: number,
  dy: number,
): DocumentOperation[] {
  const operations: DocumentOperation[] = [];
  for (const id of ids) {
    const object = document.get(id);
    if (!object) continue;
    if (object.type === 'connector') {
      const patch: ObjectPatch = {};
      for (const key of ['start', 'end'] as const) {
        const endpoint = object[key];
        if (endpoint.kind === 'point') {
          patch[key] = { kind: 'point', x: endpoint.x + dx, y: endpoint.y + dy };
        }
      }
      if (Object.keys(patch).length) operations.push({ kind: 'update', id, patch });
    } else {
      operations.push({ kind: 'update', id, patch: { x: object.x + dx, y: object.y + dy } });
    }
  }
  return operations;
}

/** Patch donnant à un objet une nouvelle emprise (redimensionnement). */
export function resizePatch(object: BoardObject, box: Box): ObjectPatch | undefined {
  if (object.type === 'connector') return undefined;
  const patch: ObjectPatch = { x: box.x, y: box.y, width: box.width, height: box.height };
  const scaleX = object.width > 0 ? box.width / object.width : 1;
  const scaleY = object.height > 0 ? box.height / object.height : 1;
  if (object.type === 'stroke') patch.points = scalePoints(object, scaleX, scaleY);
  if (object.type === 'text') patch.fontSize = Math.max(4, object.fontSize * scaleY);
  return patch;
}

function scalePoints(object: StrokeObject, scaleX: number, scaleY: number): number[] {
  const points = object.points.slice();
  for (let i = 0; i < points.length; i += 3) {
    points[i] = round((points[i] ?? 0) * scaleX);
    points[i + 1] = round((points[i + 1] ?? 0) * scaleY);
  }
  return points;
}

function mergeUpdates(operations: DocumentOperation[]): DocumentOperation[] {
  const merged = new Map<string, ObjectPatch>();
  for (const operation of operations) {
    if (operation.kind !== 'update') continue;
    merged.set(operation.id, { ...merged.get(operation.id), ...operation.patch });
  }
  return [...merged].map(([id, patch]) => ({ kind: 'update' as const, id, patch }));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
