import {
  type Box,
  expandGroups,
  moveObjectsOperations,
  objectBox,
  type Point,
  resizePatch,
  withFrameContents,
} from '@fleight/document';
import type { BoardObject } from '@fleight/protocol';
import type { PointerKind } from '../../input/input-router';
import type { ViewState } from '../../renderer';
import { HANDLE_SIZE_PX, type Handle, handleAt, resizeBox } from '../handles';
import type { Tool, ToolContext, ToolPoint } from './tool';

/** Délai et distance maximaux entre deux appuis pour un double-tap. */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 12;

type Gesture =
  | { kind: 'move'; ids: ReadonlySet<string>; last: Point; moved: boolean }
  | { kind: 'resize'; handle: Handle; origin: Point; original: BoardObject }
  | { kind: 'marquee'; origin: Point; current: Point; additive: boolean }
  | { kind: 'none' };

/** Cadre défini par deux coins opposés. */
function boxFrom(a: Point, b: Point): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Sélection et manipulation : un appui sélectionne (avec tout son groupe), un
 * glisser déplace (une frame emporte son contenu), un glisser dans le vide trace
 * un rectangle de sélection, un double-tap édite le texte, le label ou le titre.
 */
export class SelectTool implements Tool {
  readonly name = 'select' as const;
  #gesture: Gesture = { kind: 'none' };
  #lastTap: { id: string; time: number; point: Point } | undefined;

  down(context: ToolContext, point: ToolPoint, kind: PointerKind): void {
    const tolerance = context.tolerance(kind);

    // Poignée de redimensionnement de l'objet sélectionné ?
    const selectedId = context.selection.single();
    const selected = selectedId ? context.document.get(selectedId) : undefined;
    if (selected && selected.type !== 'connector') {
      const box = objectBox(context.document, selected);
      const handle =
        box && handleAt(box, point, Math.max(tolerance, HANDLE_SIZE_PX / context.zoom));
      if (handle) {
        this.#gesture = context.lock([selected.id])
          ? { kind: 'resize', handle, origin: point, original: selected }
          : { kind: 'none' };
        return;
      }
    }

    const target = context.hitTest(point, tolerance);
    // Objet en cours de modification par un autre participant : intouchable.
    if (target && context.lockedBy(target.id)) {
      this.#gesture = { kind: 'none' };
      this.#lastTap = undefined;
      return;
    }
    if (!target) {
      // Glisser dans le vide : rectangle de sélection.
      this.#gesture = {
        kind: 'marquee',
        origin: point,
        current: point,
        additive: context.modifiers.shift,
      };
      this.#lastTap = undefined;
      return;
    }

    if (this.#isDoubleTap(target.id, point, context.zoom)) {
      this.#lastTap = undefined;
      this.#gesture = { kind: 'none' };
      context.selection.set([target.id]);
      if (target.type !== 'stroke' && target.type !== 'connector' && target.type !== 'image') {
        context.editText(target.id);
      }
      return;
    }
    this.#lastTap = { id: target.id, time: point.time, point };

    // Un objet groupé se sélectionne avec tout son groupe.
    const group = expandGroups(context.document, [target.id]);
    if (context.modifiers.shift) {
      const next = new Set(context.selection.ids);
      const remove = context.selection.has(target.id);
      for (const id of group) {
        if (remove) next.delete(id);
        else next.add(id);
      }
      context.selection.set(next);
    } else if (!context.selection.has(target.id)) {
      context.selection.set(group);
    }

    // Une frame emporte son contenu, sauf ce que d'autres participants modifient.
    const ids = new Set(context.selection.ids);
    for (const id of withFrameContents(context.document, context.selection.ids)) {
      if (!ids.has(id) && !context.lockedBy(id)) ids.add(id);
    }
    this.#gesture = context.lock(ids)
      ? { kind: 'move', ids, last: point, moved: false }
      : { kind: 'none' };
  }

  move(context: ToolContext, points: readonly ToolPoint[]): void {
    const point = points[points.length - 1];
    if (!point) return;
    const gesture = this.#gesture;

    if (gesture.kind === 'move') {
      const dx = point.x - gesture.last.x;
      const dy = point.y - gesture.last.y;
      if (dx === 0 && dy === 0) return;
      context.apply(moveObjectsOperations(context.document, gesture.ids, dx, dy));
      this.#gesture = { ...gesture, last: point, moved: true };
    } else if (gesture.kind === 'resize') {
      const { original } = gesture;
      const box = objectBox(context.document, original);
      if (!box) return;
      const next = resizeBox(
        box,
        gesture.handle,
        point.x - gesture.origin.x,
        point.y - gesture.origin.y,
        1 / context.zoom,
      );
      const patch = resizePatch(original, next);
      if (patch) context.apply([{ kind: 'update', id: original.id, patch }]);
    } else if (gesture.kind === 'marquee') {
      gesture.current = point;
      context.invalidate();
    }
  }

  up(context: ToolContext): void {
    const gesture = this.#gesture;
    this.#gesture = { kind: 'none' };
    if (gesture.kind === 'move' && gesture.moved) this.#lastTap = undefined;
    if (gesture.kind === 'marquee') {
      context.invalidate();
      this.#selectInside(context, gesture);
    }
  }

  cancel(context: ToolContext): void {
    if (this.#gesture.kind === 'marquee') context.invalidate();
    this.#gesture = { kind: 'none' };
  }

  paint(ctx: CanvasRenderingContext2D, view: ViewState): void {
    const gesture = this.#gesture;
    if (gesture.kind !== 'marquee') return;
    const box = boxFrom(gesture.origin, gesture.current);
    ctx.save();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1 / view.zoom;
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.restore();
  }

  /** Fin du rectangle de sélection : objets entièrement compris, avec leurs groupes. */
  #selectInside(
    context: ToolContext,
    gesture: { origin: Point; current: Point; additive: boolean },
  ): void {
    const area = boxFrom(gesture.origin, gesture.current);
    // Simple appui dans le vide : désélection (sauf avec Maj).
    if (Math.max(area.width, area.height) * context.zoom < 3) {
      if (!gesture.additive) context.selection.clear();
      return;
    }
    const enclosed: string[] = [];
    for (const object of context.document.all()) {
      if (context.lockedBy(object.id)) continue;
      const box = objectBox(context.document, object);
      if (box && contains(area, box)) enclosed.push(object.id);
    }
    const ids = expandGroups(context.document, enclosed);
    context.selection.set(gesture.additive ? [...context.selection.ids, ...ids] : ids);
  }

  #isDoubleTap(id: string, point: ToolPoint, zoom: number): boolean {
    const last = this.#lastTap;
    return (
      !!last &&
      last.id === id &&
      point.time - last.time <= DOUBLE_TAP_MS &&
      Math.hypot(point.x - last.point.x, point.y - last.point.y) * zoom <= DOUBLE_TAP_PX
    );
  }
}
