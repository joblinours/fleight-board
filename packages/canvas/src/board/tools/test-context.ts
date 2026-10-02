import { BoardDocument, hitTestObject } from '@fleight/document';
import type { BoardObject } from '@fleight/protocol';
import { Selection } from '../selection';
import type { ToolContext, ToolName, ToolPoint } from './tool';

/** Contexte d'outil réel (document, sélection) sans DOM, pour les tests. */
export function createTestContext(
  objects: BoardObject[] = [],
  zoom = 1,
  /** Objets modifiés par un autre participant : id → nom. */
  lockedByOthers: Record<string, string> = {},
) {
  const document = new BoardDocument();
  document.load(objects);
  const selection = new Selection();
  const calls = { editText: [] as string[], tools: [] as ToolName[], locked: [] as string[] };
  let nextId = 0;
  const context: ToolContext = {
    document,
    selection,
    style: { color: '#111', fill: '#fff', strokeWidth: 2, penSize: 4, opacity: 1 },
    zoom,
    modifiers: { shift: false },
    tolerance: () => 4 / zoom,
    hitTest(point, tolerance, filter) {
      const candidates = [...document.all()].sort((a, b) => b.zIndex - a.zIndex);
      return candidates.find(
        (object) =>
          (!filter || filter(object)) && hitTestObject(document, object, point, tolerance),
      );
    },
    apply: (operations) => {
      document.apply(operations);
    },
    lockedBy: (id) => {
      const name = lockedByOthers[id];
      return name ? { name, color: '#f00' } : undefined;
    },
    lock: (ids) => {
      const list = [...ids];
      if (list.some((id) => lockedByOthers[id])) return false;
      calls.locked.push(...list);
      return true;
    },
    nextZIndex: () => document.topZIndex() + 1,
    createId: () => `new-${nextId++}`,
    editText: (id) => calls.editText.push(id),
    setTool: (name) => calls.tools.push(name),
    invalidate: () => {},
  };
  return { context, document, selection, calls };
}

let time = 0;
export function at(x: number, y: number, pressure = 0.5): ToolPoint {
  time += 100;
  return { x, y, pressure, time };
}
