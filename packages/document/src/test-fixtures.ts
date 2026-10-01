import type { ConnectorObject, Endpoint, RectangleObject, StrokeObject } from '@fleight/protocol';

export function rectangle(id: string, x = 0, y = 0, width = 100, height = 50): RectangleObject {
  return {
    type: 'rectangle',
    id,
    zIndex: 0,
    x,
    y,
    width,
    height,
    fill: '#fff',
    stroke: '#000',
    strokeWidth: 2,
    label: '',
  };
}

export function connector(id: string, start: Endpoint, end: Endpoint): ConnectorObject {
  return {
    type: 'connector',
    id,
    zIndex: 1,
    start,
    end,
    stroke: '#000',
    strokeWidth: 2,
    arrowStart: false,
    arrowEnd: true,
  };
}

export function stroke(id: string, points: number[], x = 0, y = 0): StrokeObject {
  return {
    type: 'stroke',
    id,
    zIndex: 2,
    x,
    y,
    width: 100,
    height: 100,
    points,
    color: '#000',
    size: 4,
    opacity: 1,
    simulatePressure: false,
  };
}
