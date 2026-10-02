import type { Point } from '@fleight/document';
import type { ViewState } from '../../renderer';
import type { Tool, ToolContext, ToolPoint } from './tool';

/** Taille d'une frame créée par un simple appui. */
export const DEFAULT_FRAME_SIZE = { width: 640, height: 400 };
const CLICK_THRESHOLD_PX = 6;

/** Crée une frame en tirant un cadre ; elle est placée sous tous les objets. */
export class FrameTool implements Tool {
  readonly name = 'frame' as const;
  #origin: Point | undefined;
  #current: Point | undefined;

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
    let bottom = 0;
    let frames = 0;
    for (const object of context.document.all()) {
      bottom = Math.min(bottom, object.zIndex);
      if (object.type === 'frame') frames += 1;
    }
    const id = context.createId();
    context.apply([
      {
        kind: 'create',
        object: {
          type: 'frame',
          id,
          // Sous tous les objets : la frame sert de fond à son contenu.
          zIndex: bottom - 1,
          ...box,
          title: `Frame ${frames + 1}`,
          fill: '#f8fafc',
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
    const box = this.#box(view.zoom);
    if (!box || !this.#origin) return;
    ctx.save();
    ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5 / view.zoom;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.restore();
  }

  #box(zoom: number) {
    const origin = this.#origin;
    const current = this.#current;
    if (!origin || !current) return undefined;
    const width = Math.abs(current.x - origin.x);
    const height = Math.abs(current.y - origin.y);
    if (Math.max(width, height) * zoom < CLICK_THRESHOLD_PX) {
      return { x: origin.x, y: origin.y, ...DEFAULT_FRAME_SIZE };
    }
    return { x: Math.min(origin.x, current.x), y: Math.min(origin.y, current.y), width, height };
  }
}
