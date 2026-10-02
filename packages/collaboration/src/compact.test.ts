import { describe, expect, it } from 'vitest';
import { compactOperations, touchedIds } from './compact';
import { rect } from './test-network';

describe('compactOperations', () => {
  it('fusionne les mises à jour successives d’un objet', () => {
    expect(
      compactOperations([
        { kind: 'update', id: 'a', patch: { x: 1 } },
        { kind: 'update', id: 'b', patch: { x: 5 } },
        { kind: 'update', id: 'a', patch: { x: 2, y: 3 } },
      ]),
    ).toEqual([
      { kind: 'update', id: 'a', patch: { x: 2, y: 3 } },
      { kind: 'update', id: 'b', patch: { x: 5 } },
    ]);
  });

  it('intègre les mises à jour à la création', () => {
    expect(
      compactOperations([
        { kind: 'create', object: rect('a') },
        { kind: 'update', id: 'a', patch: { x: 40 } },
      ]),
    ).toEqual([{ kind: 'create', object: { ...rect('a'), x: 40 } }]);
  });

  it('ne fusionne pas au-delà d’une suppression', () => {
    const operations = [
      { kind: 'update' as const, id: 'a', patch: { x: 1 } },
      { kind: 'delete' as const, id: 'a' },
      { kind: 'create' as const, object: rect('a') },
    ];
    expect(compactOperations(operations)).toEqual(operations);
  });

  it('liste les objets touchés', () => {
    expect([
      ...touchedIds([
        { kind: 'create', object: rect('a') },
        { kind: 'delete', id: 'b' },
      ]),
    ]).toEqual(['a', 'b']);
  });
});

describe('compactOperations et propriétés retirées', () => {
  it('un null fusionné dans une création retire la propriété', () => {
    const object = { ...rect('a'), opacity: 0.5 };
    expect(
      compactOperations([
        { kind: 'create', object },
        { kind: 'update', id: 'a', patch: { opacity: null } },
      ]),
    ).toEqual([{ kind: 'create', object: rect('a') }]);
  });
});
