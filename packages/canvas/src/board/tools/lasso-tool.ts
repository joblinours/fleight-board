import { expandGroups, objectBox, type Point } from '@fleight/document';
import type { ViewState } from '../../renderer';
import type { Tool, ToolContext, ToolPoint } from './tool';

/** Point dans un polygone (règle pair-impair). */
export function insidePolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as Point;
    const b = polygon[j] as Point;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Sélection au lasso : les objets entièrement entourés (les quatre coins de leur
 * cadre) sont sélectionnés, avec leurs groupes ; Maj ajoute à la sélection.
 */
export class LassoTool implements Tool {
  readonly name = 'lasso' as const;
  #path: Point[] = [];

  down(context: ToolContext, point: ToolPoint): void {
    this.#path = [point];
    context.invalidate();
  }

  move(context: ToolContext, points: readonly ToolPoint[]): void {
    if (!this.#path.length) return;
    this.#path.push(...points);
    context.invalidate();
  }

  up(context: ToolContext): void {
    const path = this.#path;
    this.#path = [];
    context.invalidate();
    if (path.length < 3) {
      if (!context.modifiers.shift) context.selection.clear();
      return;
    }
    const enclosed: string[] = [];
    for (const object of context.document.all()) {
      if (context.lockedBy(object.id)) continue;
      const box = objectBox(context.document, object);
      if (!box) continue;
      const corners = [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x, y: box.y + box.height },
        { x: box.x + box.width, y: box.y + box.height },
      ];
      if (corners.every((corner) => insidePolygon(corner, path))) enclosed.push(object.id);
    }
    const ids = expandGroups(context.document, enclosed);
    context.selection.set(context.modifiers.shift ? [...context.selection.ids, ...ids] : ids);
    if (ids.size) context.setTool('select');
  }

  cancel(context: ToolContext): void {
    this.#path = [];
    context.invalidate();
  }

  paint(ctx: CanvasRenderingContext2D, view: ViewState): void {
    const [first, ...rest] = this.#path;
    if (!first) return;
    ctx.save();
    ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
    ctx.strokeStyle = '#2563eb';
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.lineWidth = 1.5 / view.zoom;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const point of rest) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
