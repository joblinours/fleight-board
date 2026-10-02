import type { BoardObject, ConnectorObject } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { stylePatch } from '../editor';
import { ConnectorTool } from './connector-tool';
import { SelectTool } from './select-tool';
import { at, createTestContext } from './test-context';

function box(id: string, x: number, y: number): BoardObject {
  return {
    type: 'rectangle',
    id,
    zIndex: 0,
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

const connector: ConnectorObject = {
  type: 'connector',
  id: 'c',
  zIndex: 1,
  start: { kind: 'object', objectId: 'a', anchor: 'right' },
  end: { kind: 'object', objectId: 'b', anchor: 'left' },
  stroke: '#000',
  strokeWidth: 2,
  arrowStart: false,
  arrowEnd: true,
  routing: 'orthogonal',
};

describe('connecteurs orthogonaux', () => {
  it('l’outil Connecteur crée un tracé orthogonal ; Ligne reste droite', () => {
    const { context, document } = createTestContext([box('a', 0, 0), box('b', 300, 200)]);
    const tool = new ConnectorTool('connector');
    tool.down(context, at(95, 25), 'mouse');
    tool.move(context, [at(305, 225)]);
    tool.up(context);
    expect(document.get('new-0')).toMatchObject({ routing: 'orthogonal' });

    const line = new ConnectorTool('line');
    line.down(context, at(0, 400), 'mouse');
    line.move(context, [at(200, 500)]);
    line.up(context);
    expect(document.get('new-1')).not.toHaveProperty('routing');
  });

  it('style « droit » : l’outil Connecteur crée un tracé droit', () => {
    const { context, document } = createTestContext([box('a', 0, 0), box('b', 300, 200)]);
    context.style.routing = 'straight';
    const tool = new ConnectorTool('connector');
    tool.down(context, at(95, 25), 'mouse');
    tool.move(context, [at(305, 225)]);
    tool.up(context);
    expect(document.get('new-0')).not.toHaveProperty('routing');
  });

  it('stylePatch change le tracé d’un connecteur, pas celui d’une forme', () => {
    expect(stylePatch(connector, { routing: 'straight' })).toEqual({ routing: 'straight' });
    expect(stylePatch(box('a', 0, 0), { routing: 'straight' })).toEqual({});
  });
});

describe('reconnexion par glisser', () => {
  it('l’extrémité glissée s’accroche à l’ancrage le plus proche d’une autre forme', () => {
    const { context, document, selection, calls } = createTestContext([
      box('a', 0, 0),
      box('b', 300, 200),
      box('d', 300, -200),
      connector,
    ]);
    selection.set(['c']);
    const tool = new SelectTool();
    // Fin du tracé : ancrage gauche de b (300, 225).
    tool.down(context, at(300, 225), 'mouse');
    tool.move(context, [at(320, -100), at(350, -152)]);
    tool.up(context);
    expect(document.get('c')).toMatchObject({
      end: { kind: 'object', objectId: 'd', anchor: 'bottom' },
    });
    expect(calls.locked).toEqual(['c']);
  });

  it('lâchée dans le vide, l’extrémité devient libre ; elle ne s’accroche pas à l’autre bout', () => {
    const { context, document, selection } = createTestContext([
      box('a', 0, 0),
      box('b', 300, 200),
      connector,
    ]);
    selection.set(['c']);
    const tool = new SelectTool();
    tool.down(context, at(300, 225), 'mouse');
    tool.move(context, [at(50, 25)]);
    tool.up(context);
    expect(document.get('c')).toMatchObject({ end: { kind: 'point', x: 50, y: 25 } });
  });

  it('pas de reconnexion d’un connecteur modifié par un autre participant', () => {
    const locked: Record<string, string> = {};
    const { context, document, selection } = createTestContext(
      [box('a', 0, 0), box('b', 300, 200), connector],
      1,
      locked,
    );
    selection.set(['c']);
    locked.c = 'Bob';
    const tool = new SelectTool();
    tool.down(context, at(300, 225), 'mouse');
    tool.move(context, [at(600, 600)]);
    expect(document.get('c')).toMatchObject({ end: connector.end });
  });

  it('double-tap sur un connecteur : édition de son label', () => {
    const { context, calls } = createTestContext([box('a', 0, 0), box('b', 300, 200), connector]);
    const tool = new SelectTool();
    tool.down(context, at(200, 120), 'touch');
    tool.up(context);
    tool.down(context, at(201, 120), 'touch');
    expect(calls.editText).toEqual(['c']);
  });
});
