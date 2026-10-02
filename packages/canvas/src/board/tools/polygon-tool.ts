import type { Point } from '@fleight/document';
import type { ViewState } from '../../renderer';
import type { Tool, ToolContext, ToolPoint } from './tool';

/** Distance (pixels écran) sous laquelle un appui ferme le polygone. */
const CLOSE_DISTANCE_PX = 12;
const MAX_VERTICES = 200;

/**
 * Polygone : chaque appui pose un sommet ; appuyer sur le premier sommet (ou de
 * nouveau sur le dernier) ferme la forme. Échap abandonne.
 */
export class PolygonTool implements Tool {
  readonly name = 'polygon' as const;
  #vertices: Point[] = [];
  /** Position du pointeur pendant l'appui (aperçu du côté suivant). */
  #hover: Point | undefined;

  down(context: ToolContext, point: ToolPoint): void {
    const reach = CLOSE_DISTANCE_PX / context.zoom;
    const first = this.#vertices[0];
    const last = this.#vertices[this.#vertices.length - 1];
    const near = (vertex: Point | undefined) =>
      !!vertex && Math.hypot(vertex.x - point.x, vertex.y - point.y) <= reach;
    if (this.#vertices.length >= 3 && (near(first) || near(last))) {
      this.#finish(context);
      return;
    }
    if (!near(last)) this.#vertices.push({ x: point.x, y: point.y });
    if (this.#vertices.length >= MAX_VERTICES) this.#finish(context);
    context.invalidate();
  }

  move(context: ToolContext, points: readonly ToolPoint[]): void {
    this.#hover = points[points.length - 1];
    context.invalidate();
  }

  up(context: ToolContext): void {
    // Glisser déplace le dernier sommet posé : on le place là où le doigt se lève.
    const hover = this.#hover;
    const last = this.#vertices.length - 1;
    if (hover && last >= 0) this.#vertices[last] = hover;
    this.#hover = undefined;
    context.invalidate();
  }

  cancel(context: ToolContext): void {
    this.#vertices = [];
    this.#hover = undefined;
    context.invalidate();
  }

  paint(ctx: CanvasRenderingContext2D, view: ViewState): void {
    const vertices = [...this.#vertices];
    if (this.#hover) vertices[vertices.length - 1] = this.#hover;
    const [first, ...rest] = vertices;
    if (!first) return;
    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.fillStyle = '#2563eb';
    ctx.lineWidth = 1.5 / view.zoom;
    ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const vertex of rest) ctx.lineTo(vertex.x, vertex.y);
    ctx.stroke();
    // Le premier sommet, plus gros : y revenir ferme le polygone.
    for (const [index, vertex] of vertices.entries()) {
      ctx.beginPath();
      ctx.arc(vertex.x, vertex.y, (index === 0 ? 6 : 3.5) / view.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  #finish(context: ToolContext): void {
    const vertices = this.#vertices;
    this.#vertices = [];
    this.#hover = undefined;
    context.invalidate();
    if (vertices.length < 3) return;
    const xs = vertices.map(({ x }) => x);
    const ys = vertices.map(({ y }) => y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(Math.max(...xs) - x, 1);
    const height = Math.max(Math.max(...ys) - y, 1);
    const normalize = (value: number) => Math.round(value * 10_000) / 10_000;
    const id = context.createId();
    context.apply([
      {
        kind: 'create',
        object: {
          type: 'polygon',
          id,
          zIndex: context.nextZIndex(),
          x,
          y,
          width,
          height,
          points: vertices.flatMap((vertex) => [
            normalize((vertex.x - x) / width),
            normalize((vertex.y - y) / height),
          ]),
          fill: context.style.fill,
          stroke: context.style.color,
          strokeWidth: context.style.strokeWidth,
          label: '',
          ...(context.style.opacity < 1 ? { opacity: context.style.opacity } : {}),
        },
      },
    ]);
    context.selection.set([id]);
    context.setTool('select');
  }
}
