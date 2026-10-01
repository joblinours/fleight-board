import { getStroke, type StrokeOptions } from 'perfect-freehand';
import type { Bounds } from '../geometry';
import type { ItemPainter } from '../renderer';
import type { SceneItem } from '../scene';

/** Trait à main levée. Les points sont en coordonnées monde. */
export type StrokeItem = SceneItem & {
  kind: 'stroke';
  /** Triplets aplatis [x, y, pression, x, y, pression, …]. */
  points: number[];
  color: string;
  /** Épaisseur de base, en unités monde. */
  size: number;
  opacity: number;
  /** Pression simulée à partir de la vitesse (souris, doigt). */
  simulatePressure: boolean;
  /** Trait terminé (affine le rendu de la fin du trait). */
  complete: boolean;
};

export type StrokeStyle = Pick<StrokeItem, 'color' | 'size' | 'opacity' | 'simulatePressure'>;

/** Emprise d'un trait, épaisseur incluse. */
export function strokeBounds(points: readonly number[], size: number): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i] ?? 0;
    const y = points[i + 1] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Number.POSITIVE_INFINITY) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const margin = size;
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

/** Contour du trait (polygone) calculé par perfect-freehand. */
export function strokeOutline(
  item: Pick<StrokeItem, 'points' | 'size' | 'simulatePressure' | 'complete'>,
) {
  const input: number[][] = [];
  for (let i = 0; i < item.points.length; i += 3) {
    input.push([item.points[i] ?? 0, item.points[i + 1] ?? 0, item.points[i + 2] ?? 0.5]);
  }
  const options: StrokeOptions = {
    size: item.size,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: item.simulatePressure,
    last: item.complete,
  };
  return getStroke(input, options);
}

/** Convertit un contour en Path2D avec des courbes quadratiques entre les milieux. */
export function outlineToPath(outline: readonly number[][]): Path2D {
  const path = new Path2D();
  const count = outline.length;
  const first = outline[0];
  if (!first) return path;
  if (count < 3) {
    // Point isolé : un disque.
    const [x = 0, y = 0] = first;
    path.arc(x, y, 0.5, 0, Math.PI * 2);
    return path;
  }

  const [x0 = 0, y0 = 0] = first;
  const [x1 = 0, y1 = 0] = outline[1] ?? first;
  path.moveTo((x0 + x1) / 2, (y0 + y1) / 2);
  for (let i = 1; i <= count; i++) {
    const [ax = 0, ay = 0] = outline[i % count] ?? first;
    const [bx = 0, by = 0] = outline[(i + 1) % count] ?? first;
    path.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
  }
  path.closePath();
  return path;
}

// Un trait terminé est immuable : son Path2D est calculé une seule fois.
const pathCache = new WeakMap<StrokeItem, Path2D>();

export const paintStroke: ItemPainter<StrokeItem> = (ctx, item) => {
  let path = pathCache.get(item);
  if (!path) {
    path = outlineToPath(strokeOutline(item));
    pathCache.set(item, path);
  }
  ctx.globalAlpha = item.opacity;
  ctx.fillStyle = item.color;
  ctx.fill(path);
  ctx.globalAlpha = 1;
};
