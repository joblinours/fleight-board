import { describe, expect, it } from 'vitest';
import { BoardDocument } from './document';
import { deleteObjectsOperations, moveObjectsOperations, resizePatch } from './edits';
import { connector, rectangle, stroke } from './test-fixtures';

function diagram() {
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
  return document;
}

describe('deleteObjectsOperations', () => {
  it('détache les connecteurs en gardant leur tracé', () => {
    const document = diagram();
    document.apply(deleteObjectsOperations(document, ['b']));

    expect(document.has('b')).toBe(false);
    expect(document.get('c')).toMatchObject({
      start: { kind: 'object', objectId: 'a' },
      end: { kind: 'point', x: 300, y: 25 },
    });
  });

  it('supprime simplement un connecteur sélectionné avec ses objets', () => {
    const document = diagram();
    document.apply(deleteObjectsOperations(document, ['a', 'b', 'c']));
    expect(document.size).toBe(0);
  });

  it('peut être annulé d’un bloc', () => {
    const document = diagram();
    const before = [...document.all()];
    const inverse = document.apply(deleteObjectsOperations(document, ['a', 'b']));
    document.apply(inverse);
    expect([...document.all()].sort((x, y) => x.id.localeCompare(y.id))).toEqual(
      before.sort((x, y) => x.id.localeCompare(y.id)),
    );
  });
});

describe('moveObjectsOperations', () => {
  it('déplace les objets et les extrémités libres des connecteurs', () => {
    const document = new BoardDocument();
    document.load([
      rectangle('a', 0, 0),
      connector(
        'c',
        { kind: 'object', objectId: 'a', anchor: 'right' },
        { kind: 'point', x: 200, y: 25 },
      ),
    ]);
    document.apply(moveObjectsOperations(document, ['a', 'c'], 10, 5));

    expect(document.get('a')).toMatchObject({ x: 10, y: 5 });
    expect(document.get('c')).toMatchObject({ end: { kind: 'point', x: 210, y: 30 } });
  });
});

describe('resizePatch', () => {
  it('met à l’échelle les points d’un trait', () => {
    const patch = resizePatch(stroke('s', [0, 0, 0.5, 100, 50, 0.5]), {
      x: 0,
      y: 0,
      width: 50,
      height: 200,
    });
    expect(patch?.points).toEqual([0, 0, 0.5, 50, 100, 0.5]);
  });

  it('ne s’applique pas aux connecteurs', () => {
    expect(
      resizePatch(connector('c', { kind: 'point', x: 0, y: 0 }, { kind: 'point', x: 1, y: 1 }), {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    ).toBeUndefined();
  });
});
