import { type BoardDocument, connectorSegment, objectBox, type Segment } from '@fleight/document';
import type { BoardObject } from '@fleight/protocol';
import type { SceneItem } from '../scene';

/** Élément de scène représentant un objet du document. */
export type BoardSceneItem = SceneItem & {
  kind: BoardObject['type'];
  object: BoardObject;
  /** Tracé résolu d'un connecteur. */
  segment?: Segment;
};

export function toSceneItem(
  document: BoardDocument,
  object: BoardObject,
): BoardSceneItem | undefined {
  const box = objectBox(document, object);
  if (!box) return undefined;
  // Marge pour l'épaisseur des contours et des traits.
  const margin =
    object.type === 'stroke' ? object.size : 'strokeWidth' in object ? object.strokeWidth : 0;
  const item: BoardSceneItem = {
    id: object.id,
    kind: object.type,
    zIndex: object.zIndex,
    object,
    bounds: {
      minX: box.x - margin,
      minY: box.y - margin,
      maxX: box.x + box.width + margin,
      maxY: box.y + box.height + margin,
    },
  };
  if (object.type === 'connector') {
    const segment = connectorSegment(document, object);
    if (segment) item.segment = segment;
  }
  return item;
}
