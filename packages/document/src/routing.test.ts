import type { BoardObject, ConnectorObject } from '@fleight/protocol';
import { describe, expect, it } from 'vitest';
import { BoardDocument } from './document';
import {
  connectorLabelBox,
  connectorPath,
  hitTestObject,
  objectBox,
  orthogonalRoute,
  pathMidpoint,
  ROUTE_STUB,
  simplifyPath,
} from './geometry';

/** Chaque segment est horizontal ou vertical. */
function orthogonal(path: { x: number; y: number }[]): boolean {
  return path.every((point, i) => {
    const previous = path[i - 1];
    return !previous || previous.x === point.x || previous.y === point.y;
  });
}

describe('routage orthogonal', () => {
  it('deux ancrages face à face : un tracé en Z par le milieu', () => {
    const path = orthogonalRoute({ x: 0, y: 0 }, 'right', { x: 200, y: 100 }, 'left');
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
  });

  it('ancrages alignés : une ligne droite', () => {
    expect(orthogonalRoute({ x: 0, y: 0 }, 'right', { x: 200, y: 0 }, 'left')).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
  });

  it('ancrages perpendiculaires : un coude en L', () => {
    const path = orthogonalRoute({ x: 0, y: 0 }, 'right', { x: 200, y: 200 }, 'top');
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
    ]);
  });

  it('cible derrière la sortie : le tracé sort de la forme puis revient par l’autre axe', () => {
    const path = orthogonalRoute({ x: 0, y: 0 }, 'right', { x: -200, y: 100 }, 'left');
    expect(orthogonal(path)).toBe(true);
    // Il sort d'abord vers la droite, d'une longueur de dégagement.
    expect(path[1]).toEqual({ x: ROUTE_STUB, y: 0 });
    expect(path.at(-2)).toEqual({ x: -200 - ROUTE_STUB, y: 100 });
  });

  it('extrémités libres : axe dominant, sans dégagement', () => {
    const path = orthogonalRoute({ x: 0, y: 0 }, undefined, { x: 300, y: 80 }, undefined);
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 150, y: 0 },
      { x: 150, y: 80 },
      { x: 300, y: 80 },
    ]);
  });

  it('simplifie les points confondus et alignés', () => {
    expect(
      simplifyPath([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 5 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 5 },
    ]);
  });

  it('milieu d’un tracé à plusieurs segments', () => {
    expect(
      pathMidpoint([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]),
    ).toEqual({ x: 100, y: 0 });
  });
});

describe('connecteur orthogonal dans le document', () => {
  const box = (id: string, x: number, y: number): BoardObject => ({
    type: 'rectangle',
    id,
    zIndex: 0,
    x,
    y,
    width: 100,
    height: 50,
    fill: '#fff',
    stroke: '#000',
    strokeWidth: 2,
    label: '',
  });
  const connector: ConnectorObject = {
    type: 'connector',
    id: 'c',
    zIndex: 1,
    start: { kind: 'object', objectId: 'a', anchor: 'right' },
    end: { kind: 'object', objectId: 'b', anchor: 'left' },
    stroke: '#000',
    strokeWidth: 2,
    arrowStart: false,
    arrowEnd: true,
    routing: 'orthogonal',
    label: 'flux',
  };
  const document = new BoardDocument();
  document.load([box('a', 0, 0), box('b', 300, 200), connector]);

  it('suit les ancrages ; contact sur les coudes et sur le label', () => {
    const path = connectorPath(document, connector);
    expect(path).toEqual([
      { x: 100, y: 25 },
      { x: 200, y: 25 },
      { x: 200, y: 225 },
      { x: 300, y: 225 },
    ]);
    expect(hitTestObject(document, connector, { x: 200, y: 150 }, 2)).toBe(true);
    // Sur la diagonale d'un tracé droit, mais pas sur le tracé orthogonal.
    expect(hitTestObject(document, connector, { x: 150, y: 75 }, 2)).toBe(false);
    const label = connectorLabelBox(connector, path ?? []);
    expect(label).toBeDefined();
    expect(
      hitTestObject(document, connector, { x: (label?.x ?? 0) + 2, y: (label?.y ?? 0) + 2 }, 0),
    ).toBe(true);
    expect(objectBox(document, connector)).toMatchObject({ x: 100 - 10, y: 25 - 10 });
  });

  it('un tracé droit par défaut', () => {
    const { routing: _routing, ...straight } = connector;
    expect(connectorPath(document, straight)).toHaveLength(2);
  });
});
