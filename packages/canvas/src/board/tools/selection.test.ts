import type { BoardObject, FrameObject, RectangleObject } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { CLIPBOARD_PREFIX, parseObjects, serializeObjects } from '../clipboard';
import { DEFAULT_FRAME_SIZE, FrameTool } from './frame-tool';
import { insidePolygon, LassoTool } from './lasso-tool';
import { SelectTool } from './select-tool';
import { at, createTestContext } from './test-context';

function rect(id: string, x: number, y: number, extra: Partial<RectangleObject> = {}): BoardObject {
  return {
    type: 'rectangle',
    id,
    zIndex: 1,
    x,
    y,
    width: 100,
    height: 50,
    fill: '#fff',
    stroke: '#000',
    strokeWidth: 2,
    label: '',
    ...extra,
  };
}

function frame(id: string, x: number, y: number, width = 400, height = 300): FrameObject {
  return { type: 'frame', id, zIndex: -1, x, y, width, height, title: 'Zone', fill: '#f8fafc' };
}

describe('rectangle de sélection', () => {
  it('sélectionne les objets entièrement compris, avec leurs groupes', () => {
    const { context, selection } = createTestContext([
      rect('a', 0, 0),
      rect('b', 200, 0, { groupId: 'g' }),
      rect('c', 1000, 0, { groupId: 'g' }),
      rect('d', 50, 200),
    ]);
    const tool = new SelectTool();
    tool.down(context, at(-10, -10), 'mouse');
    tool.move(context, [at(320, 100)]);
    tool.up(context);
    expect([...selection.ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('ajoute à la sélection avec Maj, sans déplacer d’objet', () => {
    const { context, document, selection } = createTestContext([
      rect('a', 0, 0),
      rect('d', 0, 200),
    ]);
    selection.set(['a']);
    context.modifiers.shift = true;
    const tool = new SelectTool();
    tool.down(context, at(-10, 190), 'mouse');
    tool.move(context, [at(150, 300)]);
    tool.up(context);
    expect([...selection.ids].sort()).toEqual(['a', 'd']);
    expect(document.get('d')).toMatchObject({ x: 0, y: 200 });
  });

  it('démarre dans l’intérieur vide d’une frame', () => {
    const { context, selection } = createTestContext([frame('f', 0, 0), rect('a', 100, 100)]);
    const tool = new SelectTool();
    tool.down(context, at(50, 80), 'mouse');
    tool.move(context, [at(250, 200)]);
    tool.up(context);
    expect([...selection.ids]).toEqual(['a']);
  });
});

describe('groupes et frames', () => {
  it('un appui sur un objet groupé sélectionne et déplace tout le groupe', () => {
    const { context, document, selection } = createTestContext([
      rect('a', 0, 0, { groupId: 'g' }),
      rect('b', 200, 0, { groupId: 'g' }),
      rect('c', 400, 0),
    ]);
    const tool = new SelectTool();
    tool.down(context, at(10, 10), 'mouse');
    tool.move(context, [at(20, 30)]);
    tool.up(context);
    expect([...selection.ids].sort()).toEqual(['a', 'b']);
    expect(document.get('b')).toMatchObject({ x: 210, y: 20 });
    expect(document.get('c')).toMatchObject({ x: 400, y: 0 });
  });

  it('déplacer une frame par son titre emporte son contenu, pas le reste', () => {
    const { context, document, selection, calls } = createTestContext([
      frame('f', 0, 0),
      rect('dedans', 100, 100, { zIndex: 2 }),
      rect('dehors', 350, 280, { zIndex: 2 }),
    ]);
    const tool = new SelectTool();
    tool.down(context, at(50, 10), 'mouse');
    tool.move(context, [at(150, 60)]);
    tool.up(context);
    expect([...selection.ids]).toEqual(['f']);
    expect(document.get('f')).toMatchObject({ x: 100, y: 50 });
    expect(document.get('dedans')).toMatchObject({ x: 200, y: 150 });
    expect(document.get('dehors')).toMatchObject({ x: 350, y: 280 });
    expect(calls.locked.sort()).toEqual(['dedans', 'f']);
  });

  it('le contenu modifié par un autre participant ne bloque pas la frame', () => {
    const { context, document } = createTestContext(
      [frame('f', 0, 0), rect('pris', 100, 100, { zIndex: 2 })],
      1,
      { pris: 'Bob' },
    );
    const tool = new SelectTool();
    tool.down(context, at(50, 10), 'mouse');
    tool.move(context, [at(60, 10)]);
    expect(document.get('f')).toMatchObject({ x: 10 });
    expect(document.get('pris')).toMatchObject({ x: 100 });
  });

  it('double-tap sur le titre d’une frame : édition du titre', () => {
    const { context, calls } = createTestContext([frame('f', 0, 0)]);
    const tool = new SelectTool();
    tool.down(context, at(50, 10), 'touch');
    tool.up(context);
    tool.down(context, at(52, 10), 'touch');
    expect(calls.editText).toEqual(['f']);
  });
});

describe('FrameTool', () => {
  it('crée une frame sous tous les objets, de la taille tirée', () => {
    const { context, document, selection, calls } = createTestContext([
      rect('a', 0, 0, { zIndex: -3 }),
    ]);
    const tool = new FrameTool();
    tool.down(context, at(300, 200));
    tool.move(context, [at(100, 50)]);
    tool.up(context);
    const created = document.get('new-0');
    expect(created).toMatchObject({
      type: 'frame',
      x: 100,
      y: 50,
      width: 200,
      height: 150,
      zIndex: -4,
      title: 'Frame 1',
    });
    expect([...selection.ids]).toEqual(['new-0']);
    expect(calls.tools).toEqual(['select']);
  });

  it('un simple appui crée une frame de taille par défaut', () => {
    const { context, document } = createTestContext();
    const tool = new FrameTool();
    tool.down(context, at(0, 0));
    tool.up(context);
    expect(document.get('new-0')).toMatchObject(DEFAULT_FRAME_SIZE);
  });
});

describe('LassoTool', () => {
  it('teste l’appartenance d’un point à un polygone', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(insidePolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(insidePolygon({ x: 15, y: 5 }, square)).toBe(false);
  });

  it('sélectionne les objets entièrement entourés, avec leurs groupes', () => {
    const { context, selection, calls } = createTestContext(
      [
        rect('a', 0, 0, { groupId: 'g' }),
        rect('b', 500, 500, { groupId: 'g' }),
        rect('c', 150, 0),
        rect('verrouillé', 10, 60, { width: 20, height: 20 }),
      ],
      1,
      { verrouillé: 'Bob' },
    );
    const tool = new LassoTool();
    tool.down(context, at(-20, -20));
    tool.move(context, [at(120, -20), at(120, 100), at(-20, 100)]);
    tool.up(context);
    expect([...selection.ids].sort()).toEqual(['a', 'b']);
    expect(calls.tools).toEqual(['select']);
  });
});

describe('presse-papiers', () => {
  it('sérialise et relit des objets, refuse un texte étranger ou invalide', () => {
    const objects = [rect('a', 0, 0), rect('b', 10, 10)];
    expect(parseObjects(serializeObjects(objects))).toEqual(objects);
    expect(parseObjects('bonjour')).toBeUndefined();
    expect(parseObjects(`${CLIPBOARD_PREFIX}{pas du json`)).toBeUndefined();
    expect(parseObjects(`${CLIPBOARD_PREFIX}[{"type":"inconnu"}]`)).toBeUndefined();
    expect(parseObjects(serializeObjects([rect('a', 0, 0), rect('a', 5, 5)]))).toHaveLength(1);
  });
});
