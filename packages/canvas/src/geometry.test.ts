import { describe, expect, it } from 'vitest';
import { boundsFromRect, containsPoint, expand, intersects } from './geometry';

describe('geometry', () => {
  it('normalise un rectangle de taille négative', () => {
    expect(boundsFromRect(10, 10, -5, 20)).toEqual({ minX: 5, minY: 10, maxX: 10, maxY: 30 });
  });

  it('détecte les intersections, bords inclus', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(intersects(a, { minX: 10, minY: 10, maxX: 20, maxY: 20 })).toBe(true);
    expect(intersects(a, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
  });

  it('teste l’appartenance d’un point et l’élargissement', () => {
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(containsPoint(bounds, { x: 12, y: 5 })).toBe(false);
    expect(containsPoint(expand(bounds, 2), { x: 12, y: 5 })).toBe(true);
  });
});
