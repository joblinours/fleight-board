import type { Box, Point } from '@fleight/document';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Taille d'une poignée à l'écran, en pixels. */
export const HANDLE_SIZE_PX = 9;

export function handlePosition(box: Box, handle: Handle): Point {
  const xs = { w: box.x, c: box.x + box.width / 2, e: box.x + box.width };
  const ys = { n: box.y, c: box.y + box.height / 2, s: box.y + box.height };
  const x = handle.includes('w') ? xs.w : handle.includes('e') ? xs.e : xs.c;
  const y = handle.includes('n') ? ys.n : handle.includes('s') ? ys.s : ys.c;
  return { x, y };
}

export function handleAt(box: Box, point: Point, radius: number): Handle | undefined {
  for (const handle of HANDLES) {
    const position = handlePosition(box, handle);
    if (Math.abs(position.x - point.x) <= radius && Math.abs(position.y - point.y) <= radius) {
      return handle;
    }
  }
  return undefined;
}

/** Nouvelle emprise après avoir tiré une poignée de (dx, dy) ; taille minimale `min`. */
export function resizeBox(box: Box, handle: Handle, dx: number, dy: number, min = 1): Box {
  let left = box.x;
  let top = box.y;
  let right = box.x + box.width;
  let bottom = box.y + box.height;
  if (handle.includes('w')) left += dx;
  if (handle.includes('e')) right += dx;
  if (handle.includes('n')) top += dy;
  if (handle.includes('s')) bottom += dy;
  // Retournement si la poignée passe de l'autre côté.
  const x = Math.min(left, right);
  const y = Math.min(top, bottom);
  return {
    x,
    y,
    width: Math.max(min, Math.abs(right - left)),
    height: Math.max(min, Math.abs(bottom - top)),
  };
}
