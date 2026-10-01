import { arrowSize, type Point } from '@fleight/document';
import type { ShapeObject, StrokeObject, TextObject } from '@fleight/protocol';
import { outlineToPath, strokeOutline } from '../ink/stroke';
import type { ItemPainter } from '../renderer';
import type { BoardSceneItem } from './scene-items';

export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const LINE_HEIGHT = 1.25;
export const LABEL_FONT_SIZE = 16;

const paintShape: ItemPainter<BoardSceneItem> = (ctx, { object }) => {
  if (object.type !== 'rectangle' && object.type !== 'ellipse') return;
  ctx.beginPath();
  if (object.type === 'rectangle') {
    ctx.rect(object.x, object.y, object.width, object.height);
  } else {
    ctx.ellipse(
      object.x + object.width / 2,
      object.y + object.height / 2,
      object.width / 2,
      object.height / 2,
      0,
      0,
      Math.PI * 2,
    );
  }
  ctx.fillStyle = object.fill;
  ctx.fill();
  if (object.strokeWidth > 0) {
    ctx.strokeStyle = object.stroke;
    ctx.lineWidth = object.strokeWidth;
    ctx.stroke();
  }
  if (object.label) paintLabel(ctx, object);
};

function paintLabel(ctx: CanvasRenderingContext2D, object: ShapeObject) {
  const lines = object.label.split('\n');
  const lineHeight = LABEL_FONT_SIZE * LINE_HEIGHT;
  const top = object.y + object.height / 2 - (lines.length * lineHeight) / 2 + lineHeight / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(object.x, object.y, object.width, object.height);
  ctx.clip();
  ctx.font = `${LABEL_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.fillStyle = object.stroke;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, index) => {
    ctx.fillText(line, object.x + object.width / 2, top + index * lineHeight);
  });
  ctx.restore();
}

const paintText: ItemPainter<BoardSceneItem> = (ctx, { object }) => {
  if (object.type !== 'text') return;
  paintTextObject(ctx, object);
};

function paintTextObject(ctx: CanvasRenderingContext2D, object: TextObject) {
  ctx.font = `${object.fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = object.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lineHeight = object.fontSize * LINE_HEIGHT;
  object.text.split('\n').forEach((line, index) => {
    ctx.fillText(line, object.x, object.y + index * lineHeight);
  });
}

// Le tracé d'un trait ne dépend que de ses points relatifs : déplacer l'objet
// ne recalcule rien, seul un redimensionnement (nouveaux points) le fait.
const strokePaths = new WeakMap<number[], Path2D>();

const paintStrokeObject: ItemPainter<BoardSceneItem> = (ctx, { object }) => {
  if (object.type !== 'stroke') return;
  let path = strokePaths.get(object.points);
  if (!path) {
    path = outlineToPath(strokeOutline({ ...object, complete: true }));
    strokePaths.set(object.points, path);
  }
  paintPath(ctx, object, path);
};

function paintPath(ctx: CanvasRenderingContext2D, object: StrokeObject, path: Path2D) {
  ctx.save();
  ctx.translate(object.x, object.y);
  ctx.globalAlpha = object.opacity;
  ctx.fillStyle = object.color;
  ctx.fill(path);
  ctx.restore();
}

const paintConnector: ItemPainter<BoardSceneItem> = (ctx, { object, segment }) => {
  if (object.type !== 'connector' || !segment) return;
  ctx.strokeStyle = object.stroke;
  ctx.fillStyle = object.stroke;
  ctx.lineWidth = object.strokeWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(segment.start.x, segment.start.y);
  ctx.lineTo(segment.end.x, segment.end.y);
  ctx.stroke();
  const size = arrowSize(object.strokeWidth);
  if (object.arrowEnd) paintArrowHead(ctx, segment.start, segment.end, size);
  if (object.arrowStart) paintArrowHead(ctx, segment.end, segment.start, size);
};

/** Pointe de flèche en `to`, orientée selon le segment from → to. */
export function paintArrowHead(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  size: number,
) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - spread), to.y - size * Math.sin(angle - spread));
  ctx.lineTo(to.x - size * Math.cos(angle + spread), to.y - size * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();
}

export const boardPainters: Record<BoardSceneItem['kind'], ItemPainter<BoardSceneItem>> = {
  rectangle: paintShape,
  ellipse: paintShape,
  text: paintText,
  stroke: paintStrokeObject,
  connector: paintConnector,
};
