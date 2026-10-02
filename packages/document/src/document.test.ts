import { describe, expect, it, vi } from 'vitest';
import { BoardDocument, DocumentError } from './document';
import { connector, rectangle } from './test-fixtures';

describe('BoardDocument', () => {
  it('applique create, update et delete', () => {
    const document = new BoardDocument();
    document.apply([{ kind: 'create', object: rectangle('a') }]);
    document.apply([{ kind: 'update', id: 'a', patch: { x: 50, label: 'Router' } }]);

    expect(document.get('a')).toMatchObject({ x: 50, label: 'Router' });

    document.apply([{ kind: 'delete', id: 'a' }]);
    expect(document.has('a')).toBe(false);
  });

  it('retourne des inverses qui restaurent l’état précédent', () => {
    const document = new BoardDocument();
    const undoCreate = document.apply([{ kind: 'create', object: rectangle('a') }]);
    const undoUpdate = document.apply([{ kind: 'update', id: 'a', patch: { x: 50, y: 70 } }]);

    document.apply(undoUpdate);
    expect(document.get('a')).toMatchObject({ x: 0, y: 0 });

    const undoDelete = document.apply([{ kind: 'delete', id: 'a' }]);
    document.apply(undoDelete);
    expect(document.get('a')).toEqual(rectangle('a'));

    document.apply(undoCreate);
    expect(document.size).toBe(0);
  });

  it('valide l’objet résultant et refuse id/type', () => {
    const document = new BoardDocument();
    document.apply([{ kind: 'create', object: rectangle('a') }]);

    expect(() => document.apply([{ kind: 'update', id: 'a', patch: { width: -5 } }])).toThrow();
    expect(() => document.apply([{ kind: 'update', id: 'a', patch: { type: 'ellipse' } }])).toThrow(
      DocumentError,
    );
    expect(() => document.apply([{ kind: 'create', object: rectangle('a') }])).toThrow(
      DocumentError,
    );
    expect(() => document.apply([{ kind: 'delete', id: 'inconnu' }])).toThrow(DocumentError);
  });

  it('est atomique : un échec annule les opérations déjà appliquées du lot', () => {
    const document = new BoardDocument();
    const listener = vi.fn();
    document.subscribe(listener);

    expect(() =>
      document.apply([
        { kind: 'create', object: rectangle('a') },
        { kind: 'delete', id: 'inconnu' },
      ]),
    ).toThrow();
    expect(document.size).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifie une seule fois par lot', () => {
    const document = new BoardDocument();
    const listener = vi.fn();
    document.subscribe(listener);
    document.apply([
      { kind: 'create', object: rectangle('a') },
      { kind: 'create', object: rectangle('b') },
      { kind: 'update', id: 'a', patch: { x: 1 } },
    ]);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ created: ['a', 'b'], updated: ['a'], deleted: [] });
  });

  it('indexe les connecteurs accrochés à chaque objet', () => {
    const document = new BoardDocument();
    document.apply([
      { kind: 'create', object: rectangle('a') },
      { kind: 'create', object: rectangle('b') },
      {
        kind: 'create',
        object: connector(
          'c',
          { kind: 'object', objectId: 'a', anchor: 'right' },
          { kind: 'object', objectId: 'b', anchor: 'left' },
        ),
      },
    ]);
    expect(document.connectorsOf('a')).toEqual(['c']);

    document.apply([{ kind: 'update', id: 'c', patch: { end: { kind: 'point', x: 0, y: 0 } } }]);
    expect(document.connectorsOf('b')).toEqual([]);

    document.apply([{ kind: 'delete', id: 'c' }]);
    expect(document.connectorsOf('a')).toEqual([]);
  });

  it('calcule le zIndex le plus haut', () => {
    const document = new BoardDocument();
    expect(document.topZIndex()).toBe(-1);
    document.load([{ ...rectangle('a'), zIndex: 7 }, rectangle('b')]);
    expect(document.topZIndex()).toBe(7);
  });
});

describe('propriétés facultatives', () => {
  it('null retire une propriété ; l’inverse d’une propriété absente est null', () => {
    const document = new BoardDocument();
    document.apply([{ kind: 'create', object: rectangle('a') }]);
    const [inverse] = document.apply([{ kind: 'update', id: 'a', patch: { opacity: 0.4 } }]);
    expect(document.get('a')?.opacity).toBe(0.4);
    expect(inverse).toEqual({ kind: 'update', id: 'a', patch: { opacity: null } });

    document.apply(inverse ? [inverse] : []);
    expect(document.get('a')).toEqual(rectangle('a'));
    expect(document.get('a')).not.toHaveProperty('opacity');
  });
});
