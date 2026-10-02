import type { Point } from '@fleight/document';
import type { PointerKind } from '../../input/input-router';
import type { ViewState } from '../../renderer';
import type { Tool, ToolContext, ToolPoint } from './tool';

/** Rayon de la gomme, en pixels écran. */
const RADIUS_PX = 10;

/**
 * Gomme : efface les traits à main levée (stylo, surligneur) qu'elle touche.
 * Les traits modifiés par un autre participant sont épargnés.
 */
export class EraserTool implements Tool {
  readonly name = 'eraser' as const;
  #position: Point | undefined;
  #radius = 0;
  #erased = new Set<string>();

  down(context: ToolContext, point: ToolPoint, kind: PointerKind): void {
    this.#radius = Math.max(RADIUS_PX / context.zoom, context.tolerance(kind));
    this.#erased.clear();
    this.#erase(context, [point]);
  }

  move(context: ToolContext, points: readonly ToolPoint[]): void {
    if (!this.#position) return;
    // Points intermédiaires : un geste rapide ne saute pas par-dessus un trait fin.
    const path: Point[] = [];
    let previous = this.#position;
    for (const point of points) {
      const steps = Math.ceil(
        Math.hypot(point.x - previous.x, point.y - previous.y) / this.#radius,
      );
      for (let step = 1; step <= steps; step++) {
        path.push({
          x: previous.x + ((point.x - previous.x) * step) / steps,
          y: previous.y + ((point.y - previous.y) * step) / steps,
        });
      }
      previous = point;
    }
    this.#erase(context, path);
  }

  up(context: ToolContext): void {
    this.#position = undefined;
    this.#erased.clear();
    context.invalidate();
  }

  cancel(context: ToolContext): void {
    this.up(context);
  }

  paint(ctx: CanvasRenderingContext2D, view: ViewState): void {
    if (!this.#position) return;
    ctx.save();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5 / view.zoom;
    ctx.beginPath();
    ctx.arc(this.#position.x, this.#position.y, this.#radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  #erase(context: ToolContext, path: readonly Point[]): void {
    const ids: string[] = [];
    for (const point of path) {
      const hit = context.hitTest(
        point,
        this.#radius,
        (object) =>
          object.type === 'stroke' && !this.#erased.has(object.id) && !context.lockedBy(object.id),
      );
      if (hit) {
        this.#erased.add(hit.id);
        ids.push(hit.id);
      }
    }
    if (ids.length) context.apply(ids.map((id) => ({ kind: 'delete' as const, id })));
    this.#position = path[path.length - 1] ?? this.#position;
    context.invalidate();
  }
}
