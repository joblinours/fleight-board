import { describe, expect, it, vi } from 'vitest';
import { Scene, type SceneItem } from './scene';

const item = (id: string, x: number, y: number, zIndex = 0, size = 10): SceneItem => ({
  id,
  kind: 'rect',
  zIndex,
  bounds: { minX: x, minY: y, maxX: x + size, maxY: y + size },
});

describe('Scene', () => {
  it('retourne les éléments visibles du dessous vers le dessus', () => {
    const scene = new Scene();
    scene.load([item('top', 0, 0, 2), item('bottom', 5, 5, 1), item('far', 1000, 1000, 0)]);

    const ids = scene.query({ minX: 0, minY: 0, maxX: 20, maxY: 20 }).map(({ id }) => id);
    expect(ids).toEqual(['bottom', 'top']);
  });

  it('hit-test du dessus vers le dessous, avec tolérance', () => {
    const scene = new Scene();
    scene.load([item('bottom', 0, 0, 1), item('top', 0, 0, 2)]);

    expect(scene.hitTest({ x: 5, y: 5 }).map(({ id }) => id)).toEqual(['top', 'bottom']);
    expect(scene.hitTest({ x: 13, y: 5 })).toEqual([]);
    expect(scene.hitTest({ x: 13, y: 5 }, 4)).toHaveLength(2);
  });

  it('met à jour l’index quand un élément bouge', () => {
    const scene = new Scene();
    scene.upsert(item('a', 0, 0));
    scene.upsert(item('a', 200, 200));

    expect(scene.hitTest({ x: 5, y: 5 })).toEqual([]);
    expect(scene.hitTest({ x: 205, y: 205 })).toHaveLength(1);
  });

  it('notifie les abonnés à chaque modification', () => {
    const scene = new Scene();
    const listener = vi.fn();
    const unsubscribe = scene.subscribe(listener);

    scene.upsert(item('a', 0, 0));
    scene.remove('a');
    scene.remove('a'); // déjà supprimé : pas de notification
    unsubscribe();
    scene.upsert(item('b', 0, 0));

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('calcule l’emprise du contenu', () => {
    const scene = new Scene();
    expect(scene.contentBounds()).toBeUndefined();

    scene.load([item('a', -10, 0), item('b', 100, 50, 0, 20)]);
    expect(scene.contentBounds()).toEqual({ minX: -10, minY: 0, maxX: 120, maxY: 70 });
  });
});
