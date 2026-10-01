import { describe, expect, it } from 'vitest';
import { createRandom, generateShapes } from './scene-generator';

describe('generateShapes', () => {
  it('est déterministe pour une même graine', () => {
    expect(generateShapes(50, 42)).toEqual(generateShapes(50, 42));
    expect(generateShapes(50, 42)).not.toEqual(generateShapes(50, 43));
  });

  it('génère des identifiants uniques et des formes valides', () => {
    const shapes = generateShapes(1000);
    expect(new Set(shapes.map(({ id }) => id)).size).toBe(1000);
    for (const { bounds } of shapes) {
      expect(bounds.maxX).toBeGreaterThan(bounds.minX);
      expect(bounds.maxY).toBeGreaterThan(bounds.minY);
    }
  });

  it('produit des valeurs dans [0, 1[', () => {
    const random = createRandom(7);
    for (let i = 0; i < 1000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
