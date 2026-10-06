import type { ToolName } from './tools/tool';

/** Action déclenchée par une touche (clavier physique ou clavier externe d'iPad). */
export type KeyboardCommand =
  | { kind: 'delete' }
  | { kind: 'escape' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'selectAll' }
  | { kind: 'duplicate' }
  | { kind: 'group' }
  | { kind: 'ungroup' }
  | { kind: 'bringToFront' }
  | { kind: 'sendToBack' }
  | { kind: 'tool'; tool: ToolName }
  /** Flèches : déplace la sélection (unités du monde), ou la vue sans sélection. */
  | { kind: 'arrow'; dx: number; dy: number; large: boolean }
  | { kind: 'zoomIn' }
  | { kind: 'zoomOut' }
  | { kind: 'zoomReset' }
  | { kind: 'fit' };

export type KeyInput = Pick<
  KeyboardEvent,
  'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'
>;

/** Outils sélectionnés par une lettre seule. */
export const TOOL_SHORTCUTS: Readonly<Record<string, ToolName>> = {
  v: 'select',
  r: 'rectangle',
  o: 'ellipse',
  g: 'polygon',
  t: 'text',
  c: 'connector',
  l: 'line',
  a: 'arrow',
  p: 'pen',
  h: 'highlighter',
  e: 'eraser',
  f: 'frame',
  q: 'lasso',
};

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  arrowdown: [0, 1],
};

/**
 * Traduit une touche en action de l'éditeur. Ctrl et ⌘ sont équivalents (Windows,
 * Linux, macOS, iPadOS avec clavier externe).
 */
export function keyboardCommand(event: KeyInput): KeyboardCommand | undefined {
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;

  const arrow = ARROWS[key];
  if (arrow && !mod && !event.altKey) {
    return { kind: 'arrow', dx: arrow[0], dy: arrow[1], large: event.shiftKey };
  }

  if (mod) {
    if (key === 'z') return event.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    if (key === 'y') return { kind: 'redo' };
    if (key === 'a') return { kind: 'selectAll' };
    if (key === 'd') return { kind: 'duplicate' };
    if (key === 'g') return event.shiftKey ? { kind: 'ungroup' } : { kind: 'group' };
    if (event.code === 'BracketRight' || key === ']') return { kind: 'bringToFront' };
    if (event.code === 'BracketLeft' || key === '[') return { kind: 'sendToBack' };
    // `=` et `+` selon la disposition (QWERTY, AZERTY : Maj + `=`) ; pavé numérique.
    if (key === '=' || key === '+' || event.code === 'NumpadAdd') return { kind: 'zoomIn' };
    if (key === '-' || key === '_' || event.code === 'NumpadSubtract') return { kind: 'zoomOut' };
    if (key === '0' || event.code === 'Digit0' || event.code === 'Numpad0') {
      return { kind: 'zoomReset' };
    }
    return undefined;
  }
  if (event.altKey) return undefined;

  if (key === 'delete' || key === 'backspace') return { kind: 'delete' };
  if (key === 'escape') return { kind: 'escape' };
  // Maj + 1 : tout afficher (`!` en QWERTY, `1` en AZERTY).
  if (event.shiftKey && event.code === 'Digit1') return { kind: 'fit' };
  const tool = TOOL_SHORTCUTS[key];
  return tool ? { kind: 'tool', tool } : undefined;
}
