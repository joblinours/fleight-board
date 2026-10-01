import type { RectangleObject } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { ConnectorTool } from './connector-tool';
import { PenTool } from './pen-tool';
import { SelectTool } from './select-tool';
import { DEFAULT_SHAPE_SIZE, ShapeTool } from './shape-tool';
import { at, createTestContext } from './test-context';
import { TextTool } from './text-tool';

function rect(id: string, x: number, y: number, zIndex = 0): RectangleObject {
  return {
    type: 'rectangle',
    id,
    zIndex,
    x,
    y,
    width: 100,
    height: 50,
    fill: '#fff',
    stroke: '#000',
    strokeWidth: 2,
    label: '',
  };
}

describe('SelectTool', () => {
  it('sélectionne et déplace l’objet sous le pointeur', () => {
    const { context, document, selection } = createTestContext([rect('a', 0, 0)]);
    const tool = new SelectTool();
    tool.down(context, at(10, 10), 'mouse');
    tool.move(context, [at(20, 15), at(40, 30)]);
    tool.up();

    expect([...selection.ids]).toEqual(['a']);
    expect(document.get('a')).toMatchObject({ x: 30, y: 20 });
  });

  it('vide la sélection sur un appui dans le vide, sauf avec Maj', () => {
    const { context, selection } = createTestContext([rect('a', 0, 0)]);
    const tool = new SelectTool();
    selection.set(['a']);
    context.modifiers.shift = true;
    tool.down(context, at(500, 500), 'mouse');
    expect(selection.size).toBe(1);

    context.modifiers.shift = false;
    tool.down(context, at(500, 500), 'mouse');
    expect(selection.size).toBe(0);
  });

  it('ajoute à la sélection avec Maj et déplace tout', () => {
    const { context, document, selection } = createTestContext([
      rect('a', 0, 0),
      rect('b', 200, 0),
    ]);
    const tool = new SelectTool();
    tool.down(context, at(10, 10), 'mouse');
    tool.up();
    context.modifiers.shift = true;
    tool.down(context, at(210, 10), 'mouse');
    context.modifiers.shift = false;
    tool.move(context, [at(220, 20)]);
    tool.up();

    expect(selection.size).toBe(2);
    expect(document.get('a')).toMatchObject({ x: 10, y: 10 });
    expect(document.get('b')).toMatchObject({ x: 210, y: 10 });
  });

  it('redimensionne par la poignée sud-est', () => {
    const { context, document, selection } = createTestContext([rect('a', 0, 0)]);
    const tool = new SelectTool();
    selection.set(['a']);
    tool.down(context, at(100, 50), 'mouse');
    tool.move(context, [at(150, 90)]);
    tool.up();

    expect(document.get('a')).toMatchObject({ x: 0, y: 0, width: 150, height: 90 });
  });

  it('ouvre l’édition du label au double-tap', () => {
    const { context, calls } = createTestContext([rect('a', 0, 0)]);
    const tool = new SelectTool();
    tool.down(context, at(10, 10), 'touch');
    tool.up();
    tool.down(context, at(11, 10), 'touch');

    expect(calls.editText).toEqual(['a']);
  });
});

describe('ShapeTool', () => {
  it('crée une forme de la taille du cadre tiré, puis revient à la sélection', () => {
    const { context, document, selection, calls } = createTestContext();
    const tool = new ShapeTool('ellipse');
    tool.down(context, at(100, 100));
    tool.move(context, [at(40, 160)]);
    tool.up(context);

    const created = document.get('new-0');
    expect(created).toMatchObject({ type: 'ellipse', x: 40, y: 100, width: 60, height: 60 });
    expect([...selection.ids]).toEqual(['new-0']);
    expect(calls.tools).toEqual(['select']);
  });

  it('crée une forme de taille par défaut sur un simple appui', () => {
    const { context, document } = createTestContext();
    const tool = new ShapeTool('rectangle');
    tool.down(context, at(0, 0));
    tool.up(context);

    expect(document.get('new-0')).toMatchObject({ ...DEFAULT_SHAPE_SIZE, x: -80, y: -40 });
  });
});

describe('ConnectorTool', () => {
  it('relie deux formes par leurs ancrages les plus proches', () => {
    const { context, document } = createTestContext([rect('a', 0, 0), rect('b', 300, 0)]);
    const tool = new ConnectorTool();
    tool.down(context, at(95, 25), 'mouse');
    tool.move(context, [at(200, 25), at(305, 30)]);
    tool.up(context);

    expect(document.get('new-0')).toMatchObject({
      type: 'connector',
      start: { kind: 'object', objectId: 'a', anchor: 'right' },
      end: { kind: 'object', objectId: 'b', anchor: 'left' },
      arrowEnd: true,
    });
  });

  it('laisse une extrémité libre dans le vide', () => {
    const { context, document } = createTestContext([rect('a', 0, 0)]);
    const tool = new ConnectorTool();
    tool.down(context, at(50, 45), 'mouse');
    tool.move(context, [at(50, 300)]);
    tool.up(context);

    expect(document.get('new-0')).toMatchObject({
      start: { kind: 'object', objectId: 'a', anchor: 'bottom' },
      end: { kind: 'point', x: 50, y: 300 },
    });
  });

  it('ignore un connecteur trop court', () => {
    const { context, document } = createTestContext();
    const tool = new ConnectorTool();
    tool.down(context, at(0, 0), 'mouse');
    tool.move(context, [at(3, 0)]);
    tool.up(context);
    expect(document.size).toBe(0);
  });
});

describe('PenTool', () => {
  it('crée un trait aux points relatifs à son emprise', () => {
    const { context, document } = createTestContext();
    const tool = new PenTool();
    tool.down(context, at(100, 200, 0.2), 'pen');
    tool.move(context, [at(150, 220, 0.6), at(130, 260, 0.9)]);
    tool.up(context);

    expect(document.get('new-0')).toMatchObject({
      type: 'stroke',
      x: 100,
      y: 200,
      width: 50,
      height: 60,
      points: [0, 0, 0.2, 50, 20, 0.6, 30, 60, 0.9],
      simulatePressure: false,
    });
  });
});

describe('TextTool', () => {
  it('crée un texte vide et ouvre son édition', () => {
    const { context, document, calls } = createTestContext();
    new TextTool().down(context, at(10, 20));

    expect(document.get('new-0')).toMatchObject({ type: 'text', text: '', x: 10 });
    expect(calls.editText).toEqual(['new-0']);
    expect(calls.tools).toEqual(['select']);
  });
});
