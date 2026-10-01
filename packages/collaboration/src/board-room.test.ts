import { describe, expect, it } from 'vitest';
import { BoardRoom } from './board-room';
import { rect } from './test-network';

describe('BoardRoom', () => {
  it('numérote les lots et versionne les objets', () => {
    const room = new BoardRoom('b');
    expect(room.apply([{ kind: 'create', object: rect('a') }])).toEqual({
      ok: true,
      seq: 1,
      versions: { a: 1 },
    });
    expect(room.apply([{ kind: 'update', id: 'a', patch: { x: 3 } }])).toMatchObject({
      seq: 2,
      versions: { a: 2 },
    });
    expect(room.apply([{ kind: 'delete', id: 'a' }])).toMatchObject({ seq: 3, versions: { a: 0 } });
    expect(room.snapshot()).toEqual({ boardId: 'b', seq: 3, objects: [], versions: {} });
  });

  it('refuse un lot invalide sans rien modifier', () => {
    const room = new BoardRoom('b');
    room.apply([{ kind: 'create', object: rect('a') }]);
    const result = room.apply([
      { kind: 'update', id: 'a', patch: { x: 50 } },
      { kind: 'update', id: 'absent', patch: { x: 1 } },
    ]);

    expect(result.ok).toBe(false);
    expect(room.seq).toBe(1);
    expect(room.document.get('a')).toMatchObject({ x: 0 });
  });
});
