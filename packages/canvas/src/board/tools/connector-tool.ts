import { anchorPoint, type Box, nearestAnchor, type Point } from '@fleight/document';
import type { BoardObject, Endpoint } from '@fleight/protocol';
import type { PointerKind } from '../../input/input-router';
import type { ViewState } from '../../renderer';
import { paintArrowHead } from '../painters';
import type { Tool, ToolContext, ToolPoint } from './tool';

/** Longueur minimale d'un connecteur, en pixels écran. */
const MIN_LENGTH_PX = 8;

/** Objets auxquels un connecteur peut s'accrocher. */
function connectable(object: BoardObject): boolean {
  return object.type === 'rectangle' || object.type === 'ellipse' || object.type === 'text';
}

type Drag = {
  start: Endpoint;
  startPoint: Point;
  current: Point;
  /** Objet visé par l'extrémité en cours. */
  target: (BoardObject & Box) | undefined;
  tolerance: number;
};

/** Trace un connecteur ; ses extrémités s'accrochent à l'ancrage le plus proche des formes. */
export class ConnectorTool implements Tool {
  readonly name = 'connector' as const;
  #drag: Drag | undefined;

  down(context: ToolContext, point: ToolPoint, kind: PointerKind): void {
    const tolerance = context.tolerance(kind);
    const source = this.#targetAt(context, point, tolerance);
    const start: Endpoint = source
      ? { kind: 'object', objectId: source.id, anchor: nearestAnchor(source, point) }
      : { kind: 'point', x: point.x, y: point.y };
    const startPoint =
      source && start.kind === 'object' ? anchorPoint(source, start.anchor) : point;
    this.#drag = { start, startPoint, current: point, target: undefined, tolerance };
  }

  move(context: ToolContext, points: readonly ToolPoint[]): void {
    const point = points[points.length - 1];
    if (!point || !this.#drag) return;
    this.#drag.current = point;
    this.#drag.target = this.#targetAt(context, point, this.#drag.tolerance);
    context.invalidate();
  }

  up(context: ToolContext): void {
    const drag = this.#drag;
    this.#drag = undefined;
    context.invalidate();
    if (!drag) return;

    const end = this.#endEndpoint(drag);
    const endPoint = this.#endPoint(drag);
    if (
      Math.hypot(endPoint.x - drag.startPoint.x, endPoint.y - drag.startPoint.y) * context.zoom <
      MIN_LENGTH_PX
    ) {
      return;
    }
    const id = context.createId();
    context.apply([
      {
        kind: 'create',
        object: {
          type: 'connector',
          id,
          zIndex: context.nextZIndex(),
          start: drag.start,
          end,
          stroke: context.style.color,
          strokeWidth: context.style.strokeWidth,
          arrowStart: false,
          arrowEnd: true,
        },
      },
    ]);
    context.selection.set([id]);
  }

  cancel(context: ToolContext): void {
    this.#drag = undefined;
    context.invalidate();
  }

  paint(ctx: CanvasRenderingContext2D, view: ViewState): void {
    const drag = this.#drag;
    if (!drag) return;
    const end = this.#endPoint(drag);
    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.fillStyle = '#2563eb';
    ctx.lineWidth = 2 / view.zoom;
    ctx.beginPath();
    ctx.moveTo(drag.startPoint.x, drag.startPoint.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    paintArrowHead(ctx, drag.startPoint, end, 10 / view.zoom);
    if (drag.target) paintAnchors(ctx, drag.target, view.zoom);
    ctx.restore();
  }

  #targetAt(context: ToolContext, point: Point, tolerance: number) {
    const object = context.hitTest(point, tolerance, connectable);
    return object && object.type !== 'connector' ? object : undefined;
  }

  #endEndpoint(drag: Drag): Endpoint {
    const { target, current } = drag;
    if (target && !(drag.start.kind === 'object' && drag.start.objectId === target.id)) {
      return { kind: 'object', objectId: target.id, anchor: nearestAnchor(target, current) };
    }
    return { kind: 'point', x: current.x, y: current.y };
  }

  #endPoint(drag: Drag): Point {
    const end = this.#endEndpoint(drag);
    return end.kind === 'object' && drag.target
      ? anchorPoint(drag.target, end.anchor)
      : drag.current;
  }
}

function paintAnchors(ctx: CanvasRenderingContext2D, box: Box, zoom: number) {
  const radius = 5 / zoom;
  ctx.lineWidth = 1.5 / zoom;
  for (const anchor of ['top', 'right', 'bottom', 'left'] as const) {
    const { x, y } = anchorPoint(box, anchor);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
  }
}
