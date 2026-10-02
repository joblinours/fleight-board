import { describe, expect, it } from 'vitest';
import { BoardDocument } from './document';
import {
  anchorPoint,
  connectorSegment,
  distanceToSegment,
  hitTestObject,
  nearestAnchor,
  objectBox,
  polygonVertices,
} from './geometry';
import { connector, rectangle, stroke } from './test-fixtures';

const box = { x: 0, y: 0, width: 100, height: 50 };

describe('ancrages', () => {
  it('place les ancrages au milieu des côtés', () => {
    expect(anchorPoint(box, 'top')).toEqual({ x: 50, y: 0 });
    expect(anchorPoint(box, 'right')).toEqual({ x: 100, y: 25 });
    expect(anchorPoint(box, 'bottom')).toEqual({ x: 50, y: 50 });
    expect(anchorPoint(box, 'left')).toEqual({ x: 0, y: 25 });
  });

  it('choisit l’ancrage le plus proche', () => {
    expect(nearestAnchor(box, { x: 95, y: 30 })).toBe('right');
    expect(nearestAnchor(box, { x: 40, y: 60 })).toBe('bottom');
  });
});

describe('connecteurs', () => {
  it('suivent les objets auxquels ils sont accrochés', () => {
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
    const get = () => {
      const object = document.get('c');
      if (object?.type !== 'connector') throw new Error();
      return connectorSegment(document, object);
    };
    expect(get()).toEqual({ start: { x: 100, y: 25 }, end: { x: 300, y: 25 } });

    document.apply([{ kind: 'update', id: 'b', patch: { y: 200 } }]);
    expect(get()?.end).toEqual({ x: 300, y: 225 });
  });

  it('n’ont pas d’emprise si un objet accroché a disparu', () => {
    const document = new BoardDocument();
    const c = connector(
      'c',
      { kind: 'object', objectId: 'absent', anchor: 'top' },
      { kind: 'point', x: 0, y: 0 },
    );
    expect(objectBox(document, c)).toBeUndefined();
  });

  it('ont une emprise qui inclut la flèche', () => {
    const document = new BoardDocument();
    const c = connector('c', { kind: 'point', x: 0, y: 0 }, { kind: 'point', x: 100, y: 0 });
    expect(objectBox(document, c)).toEqual({ x: -10, y: -10, width: 120, height: 20 });
  });
});

describe('hitTestObject', () => {
  const document = new BoardDocument();

  it('distance à un segment', () => {
    const segment = { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    expect(distanceToSegment({ x: 5, y: 3 }, segment)).toBe(3);
    expect(distanceToSegment({ x: 13, y: 4 }, segment)).toBe(5);
  });

  it('touche un connecteur près de son tracé seulement', () => {
    const c = connector('c', { kind: 'point', x: 0, y: 0 }, { kind: 'point', x: 100, y: 100 });
    expect(hitTestObject(document, c, { x: 50, y: 52 }, 2)).toBe(true);
    expect(hitTestObject(document, c, { x: 80, y: 20 }, 2)).toBe(false);
  });

  it('touche une ellipse dans sa forme, pas dans les coins de son emprise', () => {
    const ellipse = { ...rectangle('e'), type: 'ellipse' as const };
    expect(hitTestObject(document, ellipse, { x: 50, y: 25 }, 0)).toBe(true);
    expect(hitTestObject(document, ellipse, { x: 2, y: 2 }, 0)).toBe(false);
  });

  it('touche un trait près de ses points', () => {
    const s = stroke('s', [0, 0, 0.5, 50, 0, 0.5], 10, 10);
    expect(hitTestObject(document, s, { x: 35, y: 11 }, 1)).toBe(true);
    expect(hitTestObject(document, s, { x: 35, y: 40 }, 1)).toBe(false);
  });
});

describe('polygones', () => {
  const triangle = {
    type: 'polygon' as const,
    id: 'p',
    zIndex: 0,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    points: [0.5, 0, 1, 1, 0, 1],
    fill: '#fff',
    stroke: '#000',
    strokeWidth: 2,
    label: '',
  };

  it('convertit les sommets normalisés en coordonnées monde', () => {
    expect(polygonVertices({ ...triangle, x: 10, width: 200 })).toEqual([
      { x: 110, y: 0 },
      { x: 210, y: 100 },
      { x: 10, y: 100 },
    ]);
  });

  it('touche l’intérieur et les côtés, pas les coins vides du cadre', () => {
    const document = new BoardDocument();
    document.load([triangle]);
    expect(hitTestObject(document, triangle, { x: 50, y: 70 }, 0)).toBe(true);
    expect(hitTestObject(document, triangle, { x: 5, y: 5 }, 0)).toBe(false);
    // Juste à côté du côté gauche, dans la tolérance.
    expect(hitTestObject(document, triangle, { x: 22, y: 50 }, 3)).toBe(true);
  });
});
