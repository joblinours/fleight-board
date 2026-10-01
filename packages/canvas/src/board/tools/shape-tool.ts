import type { Point } from '@fleight/document';
import type { ViewState } from '../../renderer';
import type { Tool, ToolContext, ToolPoint } from './tool';

/** Taille d'une forme créée par un simple appui (sans glisser). */
export const DEFAULT_SHAPE_SIZE = { width: 160, height: 80 };
/** En dessous de ce glissé (pixels écran), l'appui est un clic. */
const CLICK_THRESHOLD_PX = 6;

/** Crée un rectangle ou une ellipse en tirant un cadre. */
export class ShapeTool implements Tool {
  readonly name: 'rectangle' | 'ellipse';
  #origin: Point | undefined;
  #current: Point | undefined;

  constructor(name: 'rectangle' | 'ellipse') {
    this.name = name;
  }

  down(_context: ToolContext, point: ToolPoint): void {
    this.#origin = point;
    this.#current = point;
  }

  move(context: ToolContext, points: readonly ToolPoint[]): void {
    const point = points[points.length - 1];
    if (!point || !this.#origin) return;
    this.#current = point;
    context.invalidate();
  }

  up(context: ToolContext): void {
    const box = this.#box(context.zoom);
    this.#origin = undefined;
    this.#current = undefined;
    if (!box) return;
    const id = context.createId();
    context.apply([
      {
        kind: 'create',
        object: {
          type: this.name,
          id,
          zIndex: context.nextZIndex(),
          ...box,
          fill: context.style.fill,
          stroke: context.style.color,
          strokeWidth: context.style.strokeWidth,
          label: '',
        },
      },
    ]);
    context.selection.set([id]);
    context.setTool('select');
  }

  cancel(context: ToolContext): void {
    this.#origin = undefined;
    this.#current = undefined;
    context.invalidate();
  }

  paint(ctx: CanvasRenderingContext2D, view: ViewState): void {
    if (!this.#origin || !this.#current) return;
    const box = this.#box(view.zoom);
    if (!box) return;
    ctx.save();
    ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5 / view.zoom;
    ctx.beginPath();
    if (this.name === 'rectangle') ctx.rect(box.x, box.y, box.width, box.height);
    else {
      ctx.ellipse(
        box.x + box.width / 2,
        box.y + box.height / 2,
        box.width / 2,
        box.height / 2,
        0,
        0,
        Math.PI * 2,
      );
    }
    ctx.stroke();
    ctx.restore();
  }

  #box(zoom: number) {
    const origin = this.#origin;
    const current = this.#current;
    if (!origin || !current) return undefined;
    const width = Math.abs(current.x - origin.x);
    const height = Math.abs(current.y - origin.y);
    if (Math.max(width, height) * zoom < CLICK_THRESHOLD_PX) {
      // Simple appui : forme de taille par défaut centrée sur le point.
      return {
        x: origin.x - DEFAULT_SHAPE_SIZE.width / 2,
        y: origin.y - DEFAULT_SHAPE_SIZE.height / 2,
        ...DEFAULT_SHAPE_SIZE,
      };
    }
    return {
      x: Math.min(origin.x, current.x),
      y: Math.min(origin.y, current.y),
      width,
      height,
    };
  }
}
