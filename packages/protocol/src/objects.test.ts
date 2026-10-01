import { describe, expect, it } from 'vitest';
import { BoardObjectSchema } from './objects';

const rectangle = {
  type: 'rectangle',
  id: 'r1',
  zIndex: 0,
  x: 10,
  y: 20,
  width: 160,
  height: 80,
  fill: '#fff',
  stroke: '#000',
  strokeWidth: 2,
  label: 'Firewall',
};

describe('BoardObjectSchema', () => {
  it('accepte un rectangle valide', () => {
    expect(BoardObjectSchema.parse(rectangle)).toEqual(rectangle);
  });

  it('rejette un type inconnu et des dimensions négatives', () => {
    expect(BoardObjectSchema.safeParse({ ...rectangle, type: 'hexagon' }).success).toBe(false);
    expect(BoardObjectSchema.safeParse({ ...rectangle, width: -1 }).success).toBe(false);
  });

  it('rejette les coordonnées non finies', () => {
    expect(BoardObjectSchema.safeParse({ ...rectangle, x: Number.NaN }).success).toBe(false);
    expect(BoardObjectSchema.safeParse({ ...rectangle, y: Number.POSITIVE_INFINITY }).success).toBe(
      false,
    );
  });

  it('exige des points de trait par triplets', () => {
    const stroke = {
      type: 'stroke',
      id: 's1',
      zIndex: 1,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      color: '#000',
      size: 4,
      opacity: 1,
      simulatePressure: false,
    };
    expect(BoardObjectSchema.safeParse({ ...stroke, points: [0, 0, 0.5] }).success).toBe(true);
    expect(BoardObjectSchema.safeParse({ ...stroke, points: [0, 0] }).success).toBe(false);
  });

  it('accepte un connecteur entre un objet et un point libre', () => {
    const connector = {
      type: 'connector',
      id: 'c1',
      zIndex: 2,
      start: { kind: 'object', objectId: 'r1', anchor: 'right' },
      end: { kind: 'point', x: 400, y: 60 },
      stroke: '#000',
      strokeWidth: 2,
      arrowStart: false,
      arrowEnd: true,
    };
    expect(BoardObjectSchema.safeParse(connector).success).toBe(true);
    expect(
      BoardObjectSchema.safeParse({
        ...connector,
        start: { kind: 'object', objectId: 'r1', anchor: 'middle' },
      }).success,
    ).toBe(false);
  });
});
