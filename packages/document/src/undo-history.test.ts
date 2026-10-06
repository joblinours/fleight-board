import type { Operation } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { BoardDocument } from './document';
import { connector, rectangle } from './test-fixtures';
import { equal, UndoHistory } from './undo-history';

function setup() {
  const document = new BoardDocument();
  document.load([rectangle('x', 0, 0)]);
  const history = new UndoHistory();
  /** Action locale de l'utilisateur, mémorisée dans son historique. */
  const local = (operations: Operation[], group?: string) =>
    history.track(document, operations, () => document.apply(operations), group);
  /** Action d'un autre participant : appliquée sans passer par l'historique. */
  const remote = (operations: Operation[]) => document.apply(operations);
  const apply = (operations: Operation[]) => {
    document.apply(operations);
  };
  return { document, history, local, remote, apply };
}

describe('UndoHistory', () => {
  it('annule et rétablit une modification', () => {
    const { document, history, local, apply } = setup();
    local([{ kind: 'update', id: 'x', patch: { x: 40, y: 10 } }]);

    expect(history.undo(document, apply)).toEqual({ applied: true, skipped: [] });
    expect(document.get('x')).toMatchObject({ x: 0, y: 0 });
    expect(history.redo(document, apply).applied).toBe(true);
    expect(document.get('x')).toMatchObject({ x: 40, y: 10 });
  });

  it('scénario Alice/Bob : seule la position d’Alice est restaurée, la couleur de Bob reste', () => {
    const { document, history, local, remote, apply } = setup();
    local([{ kind: 'update', id: 'x', patch: { x: 100, y: 50 } }]); // Alice déplace X
    remote([{ kind: 'update', id: 'x', patch: { fill: '#ff0000' } }]); // Bob change la couleur

    const result = history.undo(document, apply); // Alice : Ctrl+Z
    expect(result).toEqual({ applied: true, skipped: [] });
    expect(document.get('x')).toMatchObject({ x: 0, y: 0, fill: '#ff0000' });
  });

  it('ignore un objet supprimé entre-temps par un autre participant', () => {
    const { document, history, local, remote, apply } = setup();
    local([{ kind: 'update', id: 'x', patch: { x: 100 } }]);
    remote([{ kind: 'delete', id: 'x' }]);

    expect(history.undo(document, apply)).toEqual({ applied: false, skipped: ['x'] });
    expect(document.has('x')).toBe(false);
  });

  it('ne restaure pas une propriété modifiée depuis par un autre participant', () => {
    const { document, history, local, remote, apply } = setup();
    local([{ kind: 'update', id: 'x', patch: { x: 100, label: 'Firewall' } }]);
    remote([{ kind: 'update', id: 'x', patch: { x: 300 } }]);

    expect(history.undo(document, apply)).toEqual({ applied: true, skipped: ['x'] });
    expect(document.get('x')).toMatchObject({ x: 300, label: '' });
  });

  it('annule une création et une suppression', () => {
    const { document, history, local, apply } = setup();
    local([{ kind: 'create', object: rectangle('new', 200, 0) }]);
    local([{ kind: 'delete', id: 'x' }]);

    history.undo(document, apply);
    expect(document.get('x')).toEqual(rectangle('x', 0, 0));
    history.undo(document, apply);
    expect(document.has('new')).toBe(false);

    history.redo(document, apply);
    expect(document.has('new')).toBe(true);
  });

  it('regroupe les opérations d’un geste en une seule annulation', () => {
    const { document, history, local, apply } = setup();
    for (let x = 10; x <= 50; x += 10) local([{ kind: 'update', id: 'x', patch: { x } }], 'drag');
    history.endGroup('drag');

    history.undo(document, apply);
    expect(document.get('x')).toMatchObject({ x: 0 });
    expect(history.canUndo).toBe(false);
  });

  it('une nouvelle action efface les rétablissements possibles', () => {
    const { document, history, local, apply } = setup();
    local([{ kind: 'update', id: 'x', patch: { x: 10 } }]);
    history.undo(document, apply);
    expect(history.canRedo).toBe(true);

    local([{ kind: 'update', id: 'x', patch: { y: 10 } }]);
    expect(history.canRedo).toBe(false);
  });

  it('ne touche pas aux objets bloqués (verrouillés par un autre)', () => {
    const { document, history, local, apply } = setup();
    local([{ kind: 'update', id: 'x', patch: { x: 10 } }]);

    expect(history.undo(document, apply, { blocked: (id) => id === 'x' })).toEqual({
      applied: false,
      skipped: ['x'],
    });
    expect(document.get('x')).toMatchObject({ x: 10 });
  });

  it('restaure les connecteurs détachés quand on annule une suppression', () => {
    const document = new BoardDocument();
    document.load([
      rectangle('a', 0, 0),
      rectangle('b', 300, 0),
      connector(
        'c',
        { kind: 'object', objectId: 'a', anchor: 'right' },
        { kind: 'object', objectId: 'b', anchor: 'left' },
      ),
    ]);
    const history = new UndoHistory();
    const operations: Operation[] = [
      { kind: 'update', id: 'c', patch: { end: { kind: 'point', x: 300, y: 25 } } },
      { kind: 'delete', id: 'b' },
    ];
    history.track(document, operations, () => document.apply(operations));

    history.undo(document, (ops) => {
      document.apply(ops);
    });
    expect(document.has('b')).toBe(true);
    expect(document.get('c')).toMatchObject({ end: { kind: 'object', objectId: 'b' } });
  });
});

describe('equal', () => {
  it('compare des valeurs JSON en profondeur', () => {
    expect(equal({ kind: 'point', x: 1 }, { x: 1, kind: 'point' })).toBe(true);
    expect(equal([1, 2], [1, 2])).toBe(true);
    expect(equal([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(equal({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});

describe('annulation d’une propriété facultative', () => {
  it('produit un patch transmissible (null) qui retire la propriété', () => {
    const document = new BoardDocument();
    document.apply([{ kind: 'create', object: rectangle('a') }]);
    const history = new UndoHistory();
    const operations = [{ kind: 'update' as const, id: 'a', patch: { opacity: 0.3 } }];
    history.track(document, operations, () => document.apply(operations));

    const sent: unknown[] = [];
    history.undo(document, (undo) => {
      sent.push(JSON.parse(JSON.stringify(undo)));
      document.apply(undo);
    });
    expect(sent).toEqual([[{ kind: 'update', id: 'a', patch: { opacity: null } }]]);
    expect(document.get('a')).not.toHaveProperty('opacity');
  });
});
