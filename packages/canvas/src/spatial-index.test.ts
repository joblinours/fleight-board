import { describe, expect, it } from 'vitest';
import { SpatialIndex } from './spatial-index';

const box = (x: number, y: number, size = 10) => ({
  minX: x,
  minY: y,
  maxX: x + size,
  maxY: y + size,
});

describe('SpatialIndex', () => {
  it('retrouve les éléments d’une zone', () => {
    const index = new SpatialIndex();
    index.upsert('a', box(0, 0));
    index.upsert('b', box(100, 100));

    expect(index.search(box(-5, -5, 20))).toEqual(['a']);
  });

  it('met à jour la position d’un élément existant', () => {
    const index = new SpatialIndex();
    index.upsert('a', box(0, 0));
    index.upsert('a', box(500, 500));

    expect(index.size).toBe(1);
    expect(index.search(box(0, 0))).toEqual([]);
    expect(index.search(box(500, 500))).toEqual(['a']);
  });

  it('supprime un élément', () => {
    const index = new SpatialIndex();
    index.upsert('a', box(0, 0));
    index.remove('a');
    index.remove('inconnu');

    expect(index.size).toBe(0);
    expect(index.search(box(0, 0))).toEqual([]);
  });

  it('charge un grand nombre d’éléments en bloc', () => {
    const index = new SpatialIndex();
    index.upsert('ancien', box(0, 0));
    index.load(Array.from({ length: 10_000 }, (_, i) => ({ id: `i${i}`, bounds: box(i * 20, 0) })));

    expect(index.size).toBe(10_000);
    expect(index.search(box(0, 0))).toEqual(['i0']);
  });
});
