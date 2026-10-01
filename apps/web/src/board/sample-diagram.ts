import type { BoardObject, Endpoint, ShapeObject } from '@fleight/protocol';

const shape = (
  type: ShapeObject['type'],
  id: string,
  x: number,
  y: number,
  label: string,
  fill: string,
): ShapeObject => ({
  type,
  id,
  zIndex: 0,
  x,
  y,
  width: 160,
  height: 70,
  fill,
  stroke: '#1f2937',
  strokeWidth: 2,
  label,
});

const link = (
  id: string,
  from: string,
  fromAnchor: 'right' | 'bottom' | 'left' | 'top',
  to: string,
  toAnchor: 'right' | 'bottom' | 'left' | 'top',
): BoardObject => {
  const start: Endpoint = { kind: 'object', objectId: from, anchor: fromAnchor };
  const end: Endpoint = { kind: 'object', objectId: to, anchor: toAnchor };
  return {
    type: 'connector',
    id,
    zIndex: 1,
    start,
    end,
    stroke: '#1f2937',
    strokeWidth: 2,
    arrowStart: false,
    arrowEnd: true,
  };
};

/** Petit schéma réseau pour tester le modèle d'objets. */
export function sampleDiagram(): BoardObject[] {
  return [
    shape('ellipse', 'internet', 0, 0, 'Internet', '#e0f2fe'),
    shape('rectangle', 'firewall', 260, 0, 'Firewall', '#fee2e2'),
    shape('rectangle', 'router', 520, 0, 'Router', '#fef9c3'),
    shape('rectangle', 'switch', 520, 180, 'Switch', '#dcfce7'),
    shape('rectangle', 'web', 380, 360, 'Web Server', '#f3e8ff'),
    shape('rectangle', 'db', 660, 360, 'Database', '#f3e8ff'),
    link('l1', 'internet', 'right', 'firewall', 'left'),
    link('l2', 'firewall', 'right', 'router', 'left'),
    link('l3', 'router', 'bottom', 'switch', 'top'),
    link('l4', 'switch', 'bottom', 'web', 'top'),
    link('l5', 'switch', 'bottom', 'db', 'top'),
    {
      type: 'text',
      id: 'title',
      zIndex: 2,
      x: 0,
      y: -90,
      width: 300,
      height: 40,
      text: 'Architecture réseau',
      fontSize: 32,
      color: '#1f2937',
    },
  ];
}
