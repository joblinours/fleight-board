import { describe, expect, it } from 'vitest';
import { strokeBounds, strokeOutline } from './stroke';
import { StrokeBuilder } from './stroke-builder';

const style = { color: '#000', size: 4, opacity: 1, simulatePressure: false };

describe('strokeBounds', () => {
  it('englobe les points avec l’épaisseur du trait', () => {
    expect(strokeBounds([0, 0, 0.5, 10, 20, 0.5], 4)).toEqual({
      minX: -4,
      minY: -4,
      maxX: 14,
      maxY: 24,
    });
  });

  it('gère un trait vide', () => {
    expect(strokeBounds([], 4)).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

describe('strokeOutline', () => {
  it('produit un contour fermé autour des points', () => {
    const outline = strokeOutline({
      points: [0, 0, 0.5, 50, 0, 0.5, 100, 0, 0.5],
      size: 8,
      simulatePressure: false,
      complete: true,
    });

    expect(outline.length).toBeGreaterThan(4);
    const ys = outline.map(([, y]) => y ?? 0);
    expect(Math.max(...ys)).toBeGreaterThan(0);
    expect(Math.min(...ys)).toBeLessThan(0);
  });

  it('rend un trait plus épais quand la pression augmente', () => {
    const width = (pressure: number) => {
      const outline = strokeOutline({
        points: [0, 0, pressure, 50, 0, pressure, 100, 0, pressure],
        size: 8,
        simulatePressure: false,
        complete: true,
      });
      const ys = outline.map(([, y]) => y ?? 0);
      return Math.max(...ys) - Math.min(...ys);
    };

    expect(width(1)).toBeGreaterThan(width(0.1));
  });
});

describe('StrokeBuilder', () => {
  it('ignore les points trop proches du précédent', () => {
    const builder = new StrokeBuilder(style, 0, 1);
    expect(builder.add(0, 0, 0.5)).toBe(true);
    expect(builder.add(0.5, 0, 0.5)).toBe(false);
    expect(builder.add(2, 0, 0.5)).toBe(true);
    expect(builder.pointCount).toBe(2);
  });

  it('produit un nouvel objet à chaque appel, avec un identifiant stable', () => {
    const builder = new StrokeBuilder(style, 3, 1);
    builder.add(0, 0, 0.5);
    const first = builder.item();
    builder.add(10, 10, 0.7);
    const second = builder.item(true);

    expect(first).not.toBe(second);
    expect(second.id).toBe(first.id);
    expect(second.points).toEqual([0, 0, 0.5, 10, 10, 0.7]);
    expect(second.complete).toBe(true);
    expect(second.zIndex).toBe(3);
    expect(first.points).toHaveLength(3);
  });

  it('arrondit les coordonnées au centième', () => {
    const builder = new StrokeBuilder(style, 0, 0);
    builder.add(1.23456, 2.34567, 0.98765);
    expect(builder.item().points).toEqual([1.23, 2.35, 0.99]);
  });
});
