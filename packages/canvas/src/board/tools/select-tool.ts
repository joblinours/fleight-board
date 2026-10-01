import { moveObjectsOperations, objectBox, type Point, resizePatch } from '@fleight/document';
import type { BoardObject } from '@fleight/protocol';
import type { PointerKind } from '../../input/input-router';
import { HANDLE_SIZE_PX, type Handle, handleAt, resizeBox } from '../handles';
import type { Tool, ToolContext, ToolPoint } from './tool';

/** Délai et distance maximaux entre deux appuis pour un double-tap. */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 12;

type Gesture =
  | { kind: 'move'; last: Point; moved: boolean }
  | { kind: 'resize'; handle: Handle; origin: Point; original: BoardObject }
  | { kind: 'none' };

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
        this.#gesture = { kind: 'resize', handle, origin: point, original: selected };
        return;
      }
    }

    const target = context.hitTest(point, tolerance);
    if (!target) {
      if (!context.modifiers.shift) context.selection.clear();
      this.#gesture = { kind: 'none' };
      this.#lastTap = undefined;
      return;
    }

    if (this.#isDoubleTap(target.id, point, context.zoom)) {
      this.#lastTap = undefined;
      this.#gesture = { kind: 'none' };
      context.selection.set([target.id]);
      if (target.type !== 'stroke' && target.type !== 'connector') context.editText(target.id);
      return;
    }
    this.#lastTap = { id: target.id, time: point.time, point };

    if (context.modifiers.shift) context.selection.toggle(target.id);
    else if (!context.selection.has(target.id)) context.selection.set([target.id]);
    this.#gesture = { kind: 'move', last: point, moved: false };
  }

  move(context: ToolContext, points: readonly ToolPoint[]): void {
    const point = points[points.length - 1];
    if (!point) return;
    const gesture = this.#gesture;

    if (gesture.kind === 'move') {
      const dx = point.x - gesture.last.x;
      const dy = point.y - gesture.last.y;
      if (dx === 0 && dy === 0) return;
      context.apply(moveObjectsOperations(context.document, context.selection.ids, dx, dy));
      this.#gesture = { kind: 'move', last: point, moved: true };
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
    }
  }

  up(): void {
    if (this.#gesture.kind === 'move' && this.#gesture.moved) this.#lastTap = undefined;
    this.#gesture = { kind: 'none' };
  }

  cancel(): void {
    this.#gesture = { kind: 'none' };
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
