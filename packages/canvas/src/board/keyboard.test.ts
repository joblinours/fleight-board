import { describe, expect, it } from 'vitest';
import { type KeyInput, keyboardCommand } from './keyboard';

const press = (key: string, extra: Partial<KeyInput> = {}) =>
  keyboardCommand({
    key,
    code: '',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extra,
  });

describe('raccourcis clavier', () => {
  it('choisit un outil par sa lettre, Maj comprise', () => {
    expect(press('p')).toEqual({ kind: 'tool', tool: 'pen' });
    expect(press('R', { shiftKey: true })).toEqual({ kind: 'tool', tool: 'rectangle' });
    expect(press('x')).toBeUndefined();
    expect(press('p', { altKey: true })).toBeUndefined();
  });

  it('traite Ctrl et ⌘ de la même façon (clavier externe d’iPad)', () => {
    expect(press('z', { metaKey: true })).toEqual({ kind: 'undo' });
    expect(press('z', { ctrlKey: true })).toEqual({ kind: 'undo' });
    expect(press('Z', { metaKey: true, shiftKey: true })).toEqual({ kind: 'redo' });
    expect(press('y', { ctrlKey: true })).toEqual({ kind: 'redo' });
    expect(press('d', { metaKey: true })).toEqual({ kind: 'duplicate' });
    expect(press('g', { metaKey: true, shiftKey: true })).toEqual({ kind: 'ungroup' });
    expect(press('a', { metaKey: true })).toEqual({ kind: 'selectAll' });
  });

  it('reconnaît les crochets par leur position, quelle que soit la disposition', () => {
    expect(press('$', { metaKey: true, code: 'BracketRight' })).toEqual({ kind: 'bringToFront' });
    expect(press('^', { ctrlKey: true, code: 'BracketLeft' })).toEqual({ kind: 'sendToBack' });
  });

  it('déplace avec les flèches, plus loin avec Maj', () => {
    expect(press('ArrowLeft')).toEqual({ kind: 'arrow', dx: -1, dy: 0, large: false });
    expect(press('ArrowDown', { shiftKey: true })).toEqual({
      kind: 'arrow',
      dx: 0,
      dy: 1,
      large: true,
    });
    // ⌘ + flèche reste au système (début / fin de ligne, navigation).
    expect(press('ArrowUp', { metaKey: true })).toBeUndefined();
  });

  it('zoome au clavier, en QWERTY comme en AZERTY', () => {
    expect(press('=', { metaKey: true })).toEqual({ kind: 'zoomIn' });
    expect(press('+', { ctrlKey: true, shiftKey: true })).toEqual({ kind: 'zoomIn' });
    expect(press('-', { metaKey: true })).toEqual({ kind: 'zoomOut' });
    expect(press('0', { metaKey: true })).toEqual({ kind: 'zoomReset' });
    // AZERTY : ⌘ + `à` est la touche du 0.
    expect(press('à', { metaKey: true, code: 'Digit0' })).toEqual({ kind: 'zoomReset' });
    expect(press('!', { shiftKey: true, code: 'Digit1' })).toEqual({ kind: 'fit' });
    expect(press('1', { shiftKey: true, code: 'Digit1' })).toEqual({ kind: 'fit' });
  });

  it('supprime et revient à la sélection', () => {
    expect(press('Backspace')).toEqual({ kind: 'delete' });
    expect(press('Delete')).toEqual({ kind: 'delete' });
    expect(press('Escape')).toEqual({ kind: 'escape' });
  });
});
