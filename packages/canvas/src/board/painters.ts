import { arrowSize, FRAME_TITLE_BAND, type Point, polygonVertices } from '@fleight/document';
import type {
  FrameObject,
  ImageObject,
  ShapeObject,
  StrokeObject,
  TextObject,
} from '@fleight/protocol';
import { outlineToPath, strokeOutline } from '../ink/stroke';
import type { ItemPainter } from '../renderer';
import type { BoardSceneItem } from './scene-items';

export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const LINE_HEIGHT = 1.25;
export const LABEL_FONT_SIZE = 16;

/** Images des objets `image`, chargées par l'application (cache, requêtes). */
export type ImageSource = {
  /** Image prête à dessiner, ou `undefined` tant qu'elle n'est pas chargée. */
  get(assetId: string): CanvasImageSource | undefined;
};

const paintShape: ItemPainter<BoardSceneItem> = (ctx, { object }) => {
  if (object.type !== 'rectangle' && object.type !== 'ellipse' && object.type !== 'polygon') {
    return;
  }
  ctx.beginPath();
  if (object.type === 'rectangle') {
    ctx.rect(object.x, object.y, object.width, object.height);
  } else if (object.type === 'polygon') {
    const [first, ...rest] = polygonVertices(object);
    if (first) ctx.moveTo(first.x, first.y);
    for (const vertex of rest) ctx.lineTo(vertex.x, vertex.y);
    ctx.closePath();
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
  if (object.fill !== 'transparent') {
    ctx.fillStyle = object.fill;
    ctx.fill();
  }
  if (object.strokeWidth > 0) {
    ctx.strokeStyle = object.stroke;
    ctx.lineWidth = object.strokeWidth;
    ctx.lineJoin = 'round';
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

/** Image chargée, ou cadre d'attente tant qu'elle ne l'est pas. */
function paintImage(ctx: CanvasRenderingContext2D, object: ImageObject, images?: ImageSource) {
  const image = images?.get(object.assetId);
  if (image) {
    ctx.drawImage(image, object.x, object.y, object.width, object.height);
    return;
  }
  ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.fillRect(object.x, object.y, object.width, object.height);
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(object.x, object.y, object.width, object.height);
}

/** Frame : fond, bordure et titre dans le bandeau supérieur. */
function paintFrame(ctx: CanvasRenderingContext2D, object: FrameObject) {
  ctx.fillStyle = object.fill;
  ctx.fillRect(object.x, object.y, object.width, object.height);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(object.x, object.y, object.width, object.height);
  if (!object.title) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(object.x, object.y, object.width, FRAME_TITLE_BAND);
  ctx.clip();
  ctx.font = `600 16px ${FONT_FAMILY}`;
  ctx.fillStyle = '#475569';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(object.title, object.x + 10, object.y + FRAME_TITLE_BAND / 2);
  ctx.restore();
}

/** Applique l'opacité de l'objet autour de son dessin. */
function withOpacity(painter: ItemPainter<BoardSceneItem>): ItemPainter<BoardSceneItem> {
  return (ctx, item, view) => {
    const opacity = item.object.opacity ?? 1;
    if (opacity >= 1) {
      painter(ctx, item, view);
      return;
    }
    ctx.save();
    ctx.globalAlpha = opacity;
    painter(ctx, item, view);
    ctx.restore();
  };
}

/** Fonctions de dessin des objets ; `images` fournit le contenu des objets `image`. */
export function createBoardPainters(
  images?: ImageSource,
): Record<BoardSceneItem['kind'], ItemPainter<BoardSceneItem>> {
  return {
    rectangle: withOpacity(paintShape),
    ellipse: withOpacity(paintShape),
    polygon: withOpacity(paintShape),
    image: withOpacity((ctx, { object }) => {
      if (object.type === 'image') paintImage(ctx, object, images);
    }),
    frame: withOpacity((ctx, { object }) => {
      if (object.type === 'frame') paintFrame(ctx, object);
    }),
    text: withOpacity(paintText),
    stroke: withOpacity(paintStrokeObject),
    connector: withOpacity(paintConnector),
  };
}

export const boardPainters = createBoardPainters();
