import type {
  Anchor,
  BoardObject,
  BoxedObject,
  ConnectorObject,
  Endpoint,
  PolygonObject,
} from '@fleight/protocol';
import type { BoardDocument } from './document';

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
export type Segment = { start: Point; end: Point };

/** Hauteur du bandeau de titre d'une frame, en unités monde. */
export const FRAME_TITLE_BAND = 32;

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

/** Longueur du premier et du dernier segment d'un tracé orthogonal, hors d'une forme. */
export const ROUTE_STUB = 24;

const DIRECTIONS: Record<Anchor, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** Direction de sortie d'une extrémité libre : l'axe dominant vers l'autre extrémité. */
function freeDirection(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: dx < 0 ? -1 : 1, y: 0 };
  return { x: 0, y: dy < 0 ? -1 : 1 };
}

/**
 * Tracé orthogonal simple entre deux points : il sort de chaque forme dans la
 * direction de son ancrage, puis rejoint l'autre extrémité par un coude (L) ou
 * deux (Z). Les obstacles ne sont pas contournés.
 */
export function orthogonalRoute(
  start: Point,
  startAnchor: Anchor | undefined,
  end: Point,
  endAnchor: Anchor | undefined,
): Point[] {
  const ds = startAnchor ? DIRECTIONS[startAnchor] : freeDirection(start, end);
  const de = endAnchor ? DIRECTIONS[endAnchor] : freeDirection(end, start);
  const stubStart = startAnchor ? ROUTE_STUB : 0;
  const stubEnd = endAnchor ? ROUTE_STUB : 0;
  const s = { x: start.x + ds.x * stubStart, y: start.y + ds.y * stubStart };
  const e = { x: end.x + de.x * stubEnd, y: end.y + de.y * stubEnd };
  const horizontalStart = ds.y === 0;
  const horizontalEnd = de.y === 0;
  // Un coude est « en avant » s'il ne fait pas revenir le tracé sur une extrémité.
  const ahead = (from: Point, direction: Point, to: Point) =>
    (to.x - from.x) * direction.x + (to.y - from.y) * direction.y >= 0;

  let middle: Point[];
  if (horizontalStart === horizontalEnd) {
    const mx = (s.x + e.x) / 2;
    const my = (s.y + e.y) / 2;
    const viaX = [
      { x: mx, y: s.y },
      { x: mx, y: e.y },
    ];
    const viaY = [
      { x: s.x, y: my },
      { x: e.x, y: my },
    ];
    const [primary, secondary] = horizontalStart ? [viaX, viaY] : [viaY, viaX];
    const first = primary[0] as Point;
    middle = ahead(s, ds, first) && ahead(e, de, primary[1] as Point) ? primary : secondary;
  } else {
    const corner = horizontalStart ? { x: e.x, y: s.y } : { x: s.x, y: e.y };
    const other = horizontalStart ? { x: s.x, y: e.y } : { x: e.x, y: s.y };
    middle = [ahead(s, ds, corner) && ahead(e, de, corner) ? corner : other];
  }
  return simplifyPath([start, s, ...middle, e, end]);
}

/** Retire les points confondus et les points intermédiaires alignés. */
export function simplifyPath(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (last && Math.abs(last.x - point.x) < 1e-9 && Math.abs(last.y - point.y) < 1e-9) continue;
    const before = result[result.length - 2];
    if (before && last) {
      const cross =
        (last.x - before.x) * (point.y - last.y) - (last.y - before.y) * (point.x - last.x);
      const dot =
        (last.x - before.x) * (point.x - last.x) + (last.y - before.y) * (point.y - last.y);
      // Aligné et dans le même sens : le point du milieu est inutile.
      if (Math.abs(cross) < 1e-9 && dot >= 0) result.pop();
    }
    result.push(point);
  }
  return result;
}

/** Tracé d'un connecteur (au moins deux points), selon son mode de routage. */
export function connectorPath(
  document: BoardDocument,
  connector: ConnectorObject,
): Point[] | undefined {
  const start = endpointPosition(document, connector.start);
  const end = endpointPosition(document, connector.end);
  if (!start || !end) return undefined;
  if (connector.routing !== 'orthogonal') return [start, end];
  const anchor = (endpoint: Endpoint) => (endpoint.kind === 'object' ? endpoint.anchor : undefined);
  const path = orthogonalRoute(start, anchor(connector.start), end, anchor(connector.end));
  return path.length >= 2 ? path : [start, end];
}

/** Point situé à mi-longueur d'un tracé (position du label). */
export function pathMidpoint(path: readonly Point[]): Point {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Point;
    const b = path[i] as Point;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  let remaining = total / 2;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Point;
    const b = path[i] as Point;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length >= remaining && length > 0) {
      const t = remaining / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= length;
  }
  return path[0] ?? { x: 0, y: 0 };
}

/** Taille du texte d'un label de connecteur, en unités monde. */
export const CONNECTOR_LABEL_FONT_SIZE = 14;

/**
 * Cadre approximatif du label d'un connecteur, centré sur le milieu du tracé
 * (largeur estimée sans mesure du texte, pour rester indépendant du DOM).
 */
export function connectorLabelBox(
  connector: ConnectorObject,
  path: readonly Point[],
): Box | undefined {
  const label = connector.label?.trim();
  if (!label) return undefined;
  const center = pathMidpoint(path);
  const lines = label.split('\n');
  const longest = Math.max(...lines.map((line) => line.length));
  const width = Math.max(24, longest * CONNECTOR_LABEL_FONT_SIZE * 0.6 + 12);
  const height = lines.length * CONNECTOR_LABEL_FONT_SIZE * 1.25 + 6;
  return { x: center.x - width / 2, y: center.y - height / 2, width, height };
}

/** Emprise d'un objet ; celle d'un connecteur inclut sa pointe de flèche et son label. */
export function objectBox(document: BoardDocument, object: BoardObject): Box | undefined {
  if (object.type !== 'connector') {
    return { x: object.x, y: object.y, width: object.width, height: object.height };
  }
  const path = connectorPath(document, object);
  if (!path) return undefined;
  const margin = arrowSize(object.strokeWidth);
  const label = connectorLabelBox(object, path);
  const corners = label ? [label, { x: label.x + label.width, y: label.y + label.height }] : [];
  const xs = [...path, ...corners].map(({ x }) => x);
  const ys = [...path, ...corners].map(({ y }) => y);
  const x = Math.min(...xs) - margin;
  const y = Math.min(...ys) - margin;
  return {
    x,
    y,
    width: Math.max(...xs) - Math.min(...xs) + margin * 2,
    height: Math.max(...ys) - Math.min(...ys) + margin * 2,
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
      const path = connectorPath(document, object);
      if (!path) return false;
      const reach = tolerance + object.strokeWidth / 2;
      const label = connectorLabelBox(object, path);
      if (label && inBox(label, point, tolerance)) return true;
      for (let i = 1; i < path.length; i++) {
        const segment = { start: path[i - 1] as Point, end: path[i] as Point };
        if (distanceToSegment(point, segment) <= reach) return true;
      }
      return false;
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
    case 'polygon':
      return hitTestPolygon(object, point, tolerance);
    case 'frame': {
      // Une frame se saisit par son bord ou son bandeau de titre : un appui sur
      // la zone vide à l'intérieur reste libre (sélection au rectangle, contenu).
      if (!inBox(object, point, tolerance)) return false;
      const inside =
        point.x > object.x + tolerance &&
        point.x < object.x + object.width - tolerance &&
        point.y > object.y + Math.max(tolerance, FRAME_TITLE_BAND) &&
        point.y < object.y + object.height - tolerance;
      return !inside;
    }
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

/** Sommets d'un polygone en coordonnées monde. */
export function polygonVertices(object: PolygonObject): Point[] {
  const vertices: Point[] = [];
  for (let i = 0; i < object.points.length; i += 2) {
    vertices.push({
      x: object.x + (object.points[i] ?? 0) * object.width,
      y: object.y + (object.points[i + 1] ?? 0) * object.height,
    });
  }
  return vertices;
}

/** Intérieur (règle pair-impair) ou à moins de `tolerance` d'un côté. */
function hitTestPolygon(object: PolygonObject, point: Point, tolerance: number): boolean {
  if (!inBox(object, point, tolerance + object.strokeWidth)) return false;
  const vertices = polygonVertices(object);
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i] as Point;
    const b = vertices[j] as Point;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
    if (distanceToSegment(point, { start: a, end: b }) <= tolerance + object.strokeWidth / 2) {
      return true;
    }
  }
  return inside;
}

function inBox(box: Box, point: Point, tolerance: number): boolean {
  return (
    point.x >= box.x - tolerance &&
    point.x <= box.x + box.width + tolerance &&
    point.y >= box.y - tolerance &&
    point.y <= box.y + box.height + tolerance
  );
}
