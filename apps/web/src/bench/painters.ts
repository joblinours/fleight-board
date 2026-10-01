import type { ItemPainter } from '@fleight/canvas';
import type { BenchShape } from './scene-generator';

/** En dessous de cette taille à l'écran (px), une forme est réduite à un simple aplat. */
const DETAIL_THRESHOLD_PX = 8;

/** Niveau de détail : une forme minuscule à l'écran est dessinée en un seul aplat. */
function paintTiny(ctx: CanvasRenderingContext2D, shape: BenchShape, zoom: number): boolean {
  const { minX, minY, maxX, maxY } = shape.bounds;
  if (Math.max(maxX - minX, maxY - minY) * zoom >= DETAIL_THRESHOLD_PX) return false;
  ctx.fillStyle = shape.stroke;
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
  return true;
}

const paintRect: ItemPainter<BenchShape> = (ctx, shape, view) => {
  if (paintTiny(ctx, shape, view.zoom)) return;
  const { minX, minY, maxX, maxY } = shape.bounds;
  ctx.fillStyle = shape.fill;
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
  ctx.strokeStyle = shape.stroke;
  ctx.lineWidth = 2 / view.zoom;
  ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
};

const paintEllipse: ItemPainter<BenchShape> = (ctx, shape, view) => {
  if (paintTiny(ctx, shape, view.zoom)) return;
  const { minX, minY, maxX, maxY } = shape.bounds;
  ctx.beginPath();
  ctx.ellipse(
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (maxX - minX) / 2,
    (maxY - minY) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = shape.fill;
  ctx.fill();
  ctx.strokeStyle = shape.stroke;
  ctx.lineWidth = 2 / view.zoom;
  ctx.stroke();
};

export const benchPainters: Record<BenchShape['kind'], ItemPainter<BenchShape>> = {
  rect: paintRect,
  ellipse: paintEllipse,
};
