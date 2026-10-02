import { paintStroke } from '../../ink/stroke';
import { StrokeBuilder } from '../../ink/stroke-builder';
import type { PointerKind } from '../../input/input-router';
import type { ViewState } from '../../renderer';
import type { Tool, ToolContext, ToolPoint } from './tool';

/** Dessin libre ; le trait devient un objet `stroke` au levé. */
export class PenTool implements Tool {
  readonly name = 'pen' as const;
  #builder: StrokeBuilder | undefined;

  down(context: ToolContext, point: ToolPoint, kind: PointerKind): void {
    this.#builder = new StrokeBuilder(
      {
        color: context.style.color,
        size: context.style.penSize / context.zoom,
        opacity: 1,
        simulatePressure: kind !== 'pen',
      },
      0,
      0.5 / context.zoom,
    );
    this.#builder.add(point.x, point.y, point.pressure);
    context.invalidate();
  }

  move(context: ToolContext, points: readonly ToolPoint[]): void {
    if (!this.#builder) return;
    for (const point of points) this.#builder.add(point.x, point.y, point.pressure);
    context.invalidate();
  }

  up(context: ToolContext): void {
    const builder = this.#builder;
    this.#builder = undefined;
    context.invalidate();
    if (!builder) return;

    const item = builder.item(true);
    const absolute = item.points;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < absolute.length; i += 3) {
      minX = Math.min(minX, absolute[i] ?? 0);
      minY = Math.min(minY, absolute[i + 1] ?? 0);
      maxX = Math.max(maxX, absolute[i] ?? 0);
      maxY = Math.max(maxY, absolute[i + 1] ?? 0);
    }
    const points = absolute.map((value, index) => {
      const axis = index % 3;
      if (axis === 2) return value;
      return Math.round((value - (axis === 0 ? minX : minY)) * 100) / 100;
    });

    context.apply([
      {
        kind: 'create',
        object: {
          type: 'stroke',
          id: context.createId(),
          zIndex: context.nextZIndex(),
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          points,
          color: item.color,
          size: item.size,
          opacity: item.opacity,
          simulatePressure: item.simulatePressure,
        },
      },
    ]);
  }

  cancel(context: ToolContext): void {
    this.#builder = undefined;
    context.invalidate();
  }

  paint(ctx: CanvasRenderingContext2D, view: ViewState): void {
    if (this.#builder) paintStroke(ctx, this.#builder.item(), view);
  }
}
