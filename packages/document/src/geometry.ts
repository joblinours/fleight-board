import type {
  Anchor,
  BoardObject,
  BoxedObject,
  ConnectorObject,
  Endpoint,
} from '@fleight/protocol';
import type { BoardDocument } from './document';

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
export type Segment = { start: Point; end: Point };

export const ANCHORS: readonly Anchor[] = ['top', 'right', 'bottom', 'left'];

export function anchorPoint(box: Box, anchor: Anchor): Point {
  switch (anchor) {
    case 'top':
      return { x: box.x + box.width / 2, y: box.y };
    case 'right':
      return { x: box.x + box.width, y: box.y + box.height / 2 };
    case 'bottom':
      return { x: box.x + box.width / 2, y: box.y + box.height };
    case 'left':
      return { x: box.x, y: box.y + box.height / 2 };
  }
}

/** Ancrage de l'objet le plus proche d'un point. */
export function nearestAnchor(box: Box, point: Point): Anchor {
  let best: Anchor = 'top';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of ANCHORS) {
    const candidate = anchorPoint(box, anchor);
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance < bestDistance) {
      best = anchor;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Position d'une extrémité de connecteur.
 * Un objet disparu ou non accrochable donne `undefined`.
 */
export function endpointPosition(document: BoardDocument, endpoint: Endpoint): Point | undefined {
  if (endpoint.kind === 'point') return { x: endpoint.x, y: endpoint.y };
  const target = document.get(endpoint.objectId);
  if (!target || target.type === 'connector') return undefined;
  return anchorPoint(target, endpoint.anchor);
}

export function connectorSegment(
  document: BoardDocument,
  connector: ConnectorObject,
): Segment | undefined {
  const start = endpointPosition(document, connector.start);
  const end = endpointPosition(document, connector.end);
  return start && end ? { start, end } : undefined;
}

/** Emprise d'un objet ; celle d'un connecteur inclut sa pointe de flèche. */
export function objectBox(document: BoardDocument, object: BoardObject): Box | undefined {
  if (object.type !== 'connector') {
    return { x: object.x, y: object.y, width: object.width, height: object.height };
  }
  const segment = connectorSegment(document, object);
  if (!segment) return undefined;
  const margin = arrowSize(object.strokeWidth);
  const x = Math.min(segment.start.x, segment.end.x) - margin;
  const y = Math.min(segment.start.y, segment.end.y) - margin;
  return {
    x,
    y,
    width: Math.abs(segment.end.x - segment.start.x) + margin * 2,
    height: Math.abs(segment.end.y - segment.start.y) + margin * 2,
  };
}

/** Taille d'une pointe de flèche en fonction de l'épaisseur du trait. */
export function arrowSize(strokeWidth: number): number {
  return Math.max(10, strokeWidth * 4);
}

export function distanceToSegment(point: Point, segment: Segment): number {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - segment.start.x, point.y - segment.start.y);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lengthSquared,
    ),
  );
  return Math.hypot(point.x - (segment.start.x + t * dx), point.y - (segment.start.y + t * dy));
}

/** Test de contact précis (au-delà de l'emprise), avec une tolérance en unités monde. */
export function hitTestObject(
  document: BoardDocument,
  object: BoardObject,
  point: Point,
  tolerance: number,
): boolean {
  switch (object.type) {
    case 'connector': {
      const segment = connectorSegment(document, object);
      return !!segment && distanceToSegment(point, segment) <= tolerance + object.strokeWidth / 2;
    }
    case 'ellipse': {
      const rx = object.width / 2 + tolerance;
      const ry = object.height / 2 + tolerance;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (point.x - (object.x + object.width / 2)) / rx;
      const ny = (point.y - (object.y + object.height / 2)) / ry;
      return nx * nx + ny * ny <= 1;
    }
    case 'stroke':
      return hitTestStroke(object, point, tolerance);
    default:
      return inBox(object, point, tolerance);
  }
}

function hitTestStroke(
  object: Extract<BoxedObject, { type: 'stroke' }>,
  point: Point,
  tolerance: number,
): boolean {
  if (!inBox(object, point, tolerance + object.size)) return false;
  const local = { x: point.x - object.x, y: point.y - object.y };
  const reach = tolerance + object.size / 2;
  const { points } = object;
  if (points.length === 3) {
    return Math.hypot(local.x - (points[0] ?? 0), local.y - (points[1] ?? 0)) <= reach;
  }
  for (let i = 3; i < points.length; i += 3) {
    const segment = {
      start: { x: points[i - 3] ?? 0, y: points[i - 2] ?? 0 },
      end: { x: points[i] ?? 0, y: points[i + 1] ?? 0 },
    };
    if (distanceToSegment(local, segment) <= reach) return true;
  }
  return false;
}

function inBox(box: Box, point: Point, tolerance: number): boolean {
  return (
    point.x >= box.x - tolerance &&
    point.x <= box.x + box.width + tolerance &&
    point.y >= box.y - tolerance &&
    point.y <= box.y + box.height + tolerance
  );
}
