import type { SceneItem } from '@fleight/canvas';

export type BenchShape = SceneItem & {
  kind: 'rect' | 'ellipse';
  fill: string;
  stroke: string;
};

const PALETTE = ['#4c8bf5', '#34a853', '#fbbc05', '#ea4335', '#a142f4', '#24c1e0', '#f06292'];

/** Générateur pseudo-aléatoire déterministe (mulberry32) : scènes reproductibles. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Génère `count` formes réparties sur une zone carrée dont la surface croît
 * avec le nombre d'objets (densité constante, comme un vrai board qui grandit).
 */
export function generateShapes(count: number, seed = 1): BenchShape[] {
  const random = createRandom(seed);
  const side = Math.sqrt(count) * 160;
  const shapes: BenchShape[] = [];

  for (let i = 0; i < count; i++) {
    const width = 20 + random() * 120;
    const height = 20 + random() * 120;
    const x = random() * side;
    const y = random() * side;
    const color = PALETTE[Math.floor(random() * PALETTE.length)] ?? '#4c8bf5';
    shapes.push({
      id: `shape-${i}`,
      kind: random() < 0.5 ? 'rect' : 'ellipse',
      zIndex: i,
      bounds: { minX: x, minY: y, maxX: x + width, maxY: y + height },
      fill: `${color}33`,
      stroke: color,
    });
  }
  return shapes;
}
