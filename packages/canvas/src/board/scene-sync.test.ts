import { BoardDocument } from '@fleight/document';
import type { BoardObject } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { Scene } from '../scene';
import type { BoardSceneItem } from './scene-items';
import { syncScene } from './scene-sync';

const objects: BoardObject[] = [
  {
    type: 'rectangle',
    id: 'a',
    zIndex: 0,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    fill: '#fff',
    stroke: '#000',
    strokeWidth: 2,
    label: '',
  },
  {
    type: 'connector',
    id: 'c',
    zIndex: 1,
    start: { kind: 'object', objectId: 'a', anchor: 'right' },
    end: { kind: 'point', x: 300, y: 25 },
    stroke: '#000',
    strokeWidth: 2,
    arrowStart: false,
    arrowEnd: true,
  },
];

describe('syncScene', () => {
  it('reflète le document et recalcule les connecteurs avec leurs objets', () => {
    const document = new BoardDocument();
    document.load(objects);
    const scene = new Scene<BoardSceneItem>();
    syncScene(document, scene);

    expect(scene.size).toBe(2);
    expect(scene.get('c')?.path?.[0]).toEqual({ x: 100, y: 25 });

    document.apply([{ kind: 'update', id: 'a', patch: { y: 100 } }]);
    expect(scene.get('c')?.path?.[0]).toEqual({ x: 100, y: 125 });
  });

  it('retire de la scène un connecteur dont l’objet a disparu', () => {
    const document = new BoardDocument();
    document.load(objects);
    const scene = new Scene<BoardSceneItem>();
    syncScene(document, scene);

    document.apply([{ kind: 'delete', id: 'a' }]);
    expect(scene.get('a')).toBeUndefined();
    expect(scene.get('c')).toBeUndefined();
  });

  it('cesse la synchronisation après désabonnement', () => {
    const document = new BoardDocument();
    const scene = new Scene<BoardSceneItem>();
    const stop = syncScene(document, scene);
    stop();
    document.load(objects);
    expect(scene.size).toBe(0);
  });
});
