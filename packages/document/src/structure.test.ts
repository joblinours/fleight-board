import type { BoardObject, FrameObject } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { BoardDocument } from './document';
import { hitTestObject } from './geometry';
import {
  copyObjects,
  expandGroups,
  frameContents,
  groupOperations,
  pasteOperations,
  ungroupOperations,
  withFrameContents,
  zOrderOperations,
} from './structure';
import { connector, rectangle } from './test-fixtures';

const frame = (id: string, x: number, y: number, width: number, height: number): FrameObject => ({
  type: 'frame',
  id,
  zIndex: -1,
  x,
  y,
  width,
  height,
  title: 'Zone',
  fill: '#f8fafc',
});

function documentWith(...objects: BoardObject[]) {
  const document = new BoardDocument();
  document.load(objects);
  return document;
}

describe('frames', () => {
  it('contiennent les objets entièrement compris dans leur cadre', () => {
    const zone = frame('f', 0, 0, 400, 300);
    const document = documentWith(
      zone,
      rectangle('dedans', 50, 50),
      rectangle('à cheval', 350, 50),
      rectangle('dehors', 500, 50),
    );
    expect(frameContents(document, zone)).toEqual(['dedans']);
    expect([...withFrameContents(document, ['f'])].sort()).toEqual(['dedans', 'f']);
  });

  it('se saisissent par le bord ou le bandeau de titre, pas par l’intérieur vide', () => {
    const zone = frame('f', 0, 0, 400, 300);
    const document = documentWith(zone);
    expect(hitTestObject(document, zone, { x: 200, y: 10 }, 4)).toBe(true);
    expect(hitTestObject(document, zone, { x: 1, y: 150 }, 4)).toBe(true);
    expect(hitTestObject(document, zone, { x: 200, y: 150 }, 4)).toBe(false);
  });
});

describe('groupes', () => {
  it('un objet entraîne les autres membres de son groupe', () => {
    const document = documentWith(rectangle('a'), rectangle('b'), rectangle('c'));
    document.apply(groupOperations(['a', 'b'], 'g1'));
    expect([...expandGroups(document, ['a'])].sort()).toEqual(['a', 'b']);
    expect([...expandGroups(document, ['c'])]).toEqual(['c']);

    document.apply(ungroupOperations(document, ['a', 'b', 'c']));
    expect(document.get('a')).not.toHaveProperty('groupId');
    expect([...expandGroups(document, ['a'])]).toEqual(['a']);
  });
});

describe('copier-coller', () => {
  it('décale les copies, renouvelle identifiants et groupes, garde les liens internes', () => {
    const document = documentWith(
      { ...rectangle('a', 0, 0), groupId: 'g', zIndex: 2 },
      { ...rectangle('b', 200, 0), groupId: 'g', zIndex: 3 },
      rectangle('externe', 0, 200),
      connector(
        'lien',
        { kind: 'object', objectId: 'a', anchor: 'right' },
        { kind: 'object', objectId: 'b', anchor: 'left' },
      ),
      connector(
        'vers-externe',
        { kind: 'object', objectId: 'a', anchor: 'bottom' },
        { kind: 'object', objectId: 'externe', anchor: 'top' },
      ),
    );
    const copies = copyObjects(document, ['a', 'b', 'lien', 'vers-externe']);
    // L'extrémité vers un objet non copié devient un point libre.
    expect(copies.find(({ id }) => id === 'vers-externe')).toMatchObject({
      end: { kind: 'point', x: 50, y: 200 },
    });

    let next = 0;
    const { operations, ids } = pasteOperations(copies, {
      createId: () => `n${next++}`,
      offset: 24,
      zIndexStart: 10,
    });
    document.apply(operations);
    expect(ids).toHaveLength(4);
    const pasted = ids.map((id) => document.get(id));
    const [copyA, copyB] = pasted.filter((object) => object?.type === 'rectangle');
    expect(copyA).toMatchObject({ x: 24, y: 24 });
    expect(copyA?.groupId).toBeDefined();
    expect(copyA?.groupId).not.toBe('g');
    expect(copyB?.groupId).toBe(copyA?.groupId);
    const link = pasted.find(
      (object) =>
        object?.type === 'connector' &&
        object.start.kind === 'object' &&
        object.end.kind === 'object',
    );
    expect(link).toMatchObject({
      start: { objectId: copyA?.id },
      end: { objectId: copyB?.id },
    });
    expect(pasted.every((object) => (object?.zIndex ?? 0) >= 10)).toBe(true);
  });
});

describe('ordre', () => {
  it('met au premier plan ou à l’arrière-plan en gardant l’ordre relatif', () => {
    const document = documentWith(
      { ...rectangle('a'), zIndex: 1 },
      { ...rectangle('b'), zIndex: 2 },
      { ...rectangle('c'), zIndex: 3 },
    );
    document.apply(zOrderOperations(document, ['a', 'b'], 'front'));
    expect([document.get('a')?.zIndex, document.get('b')?.zIndex]).toEqual([4, 5]);
    const order = () => [...document.all()].sort((x, y) => x.zIndex - y.zIndex).map(({ id }) => id);
    expect(order()).toEqual(['c', 'a', 'b']);
    document.apply(zOrderOperations(document, ['b'], 'back'));
    expect(order()).toEqual(['b', 'c', 'a']);
  });
});
