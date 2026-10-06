import { paintStroke } from '../../ink/stroke';
import { StrokeBuilder } from '../../ink/stroke-builder';
import type { PointerKind } from '../../input/input-router';
import type { ViewState } from '../../renderer';
import type { Tool, ToolContext, ToolPoint } from './tool';

/** Surligneur : trait large, translucide et d'épaisseur constante. */
const HIGHLIGHTER = { sizeFactor: 4, opacity: 0.35 };

/** Dessin libre (stylo ou surligneur) ; le trait devient un objet `stroke` au levé. */
export class PenTool implements Tool {
  readonly name: 'pen' | 'highlighter';
  #builder: StrokeBuilder | undefined;

  constructor(name: 'pen' | 'highlighter' = 'pen') {
    this.name = name;
  }

  down(context: ToolContext, point: ToolPoint, kind: PointerKind): void {
    const highlighter = this.name === 'highlighter';
    this.#builder = new StrokeBuilder(
      {
        color: context.style.color,
        size: (context.style.penSize * (highlighter ? HIGHLIGHTER.sizeFactor : 1)) / context.zoom,
        opacity: highlighter ? HIGHLIGHTER.opacity : context.style.opacity,
        simulatePressure: !highlighter && kind !== 'pen',
      },
      0,
      0.5 / context.zoom,
    );
    this.#add(point);
    context.invalidate();
  }

  move(context: ToolContext, points: readonly ToolPoint[]): void {
    if (!this.#builder) return;
    for (const point of points) this.#add(point);
    context.invalidate();
  }

  /** Le surligneur ignore la pression : épaisseur constante. */
  #add(point: ToolPoint): void {
    const pressure = this.name === 'highlighter' ? 0.5 : point.pressure;
    this.#builder?.add(point.x, point.y, pressure);
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
