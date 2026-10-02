import { describe, expect, it, vi } from 'vitest';
import { Camera } from './camera';
import { CanvasRenderer, gridSpacing } from './renderer';
import { Scene, type SceneItem } from './scene';

const item = (id: string, x: number, y: number, kind = 'rect'): SceneItem => ({
  id,
  kind,
  zIndex: 0,
  bounds: { minX: x, minY: y, maxX: x + 10, maxY: y + 10 },
});

function createContext() {
  return {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };
}

function setup(transparent = false) {
  const ctx = createContext();
  const getContext = vi.fn(() => ctx);
  const canvas = { width: 0, height: 0, getContext } as unknown as HTMLCanvasElement;
  const scene = new Scene();
  const camera = new Camera();
  const frames: Array<() => void> = [];
  const painted: string[] = [];
  const renderer = new CanvasRenderer({
    canvas,
    scene,
    camera,
    grid: false,
    transparent,
    painters: { rect: (_ctx, { id }) => painted.push(id) },
    scheduleFrame: (callback) => frames.push(callback),
    now: () => 0,
  });
  const flush = () => {
    for (const frame of frames.splice(0)) frame();
  };
  return { ctx, canvas, getContext, scene, camera, renderer, painted, frames, flush };
}

describe('CanvasRenderer', () => {
  it('ne dessine que les éléments visibles', () => {
    const { scene, renderer, painted, flush } = setup();
    renderer.resize(100, 100);
    scene.load([item('visible', 10, 10), item('hors-champ', 500, 500)]);
    flush();

    expect(painted).toEqual(['visible']);
    expect(renderer.stats.drawnItems).toBe(1);
  });

  it('fusionne les demandes de rendu dans une seule frame', () => {
    const { scene, renderer, frames, flush } = setup();
    renderer.resize(100, 100);
    scene.upsert(item('a', 0, 0));
    scene.upsert(item('b', 0, 0));
    renderer.requestRender();

    expect(frames).toHaveLength(1);
    flush();
    expect(renderer.stats.frames).toBe(1);
  });

  it('adapte la résolution du canvas à la densité de l’écran', () => {
    const { canvas, renderer } = setup();
    renderer.resize(300, 200, 2);

    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(400);
    expect(renderer.viewport).toEqual({ width: 300, height: 200 });
  });

  it('applique la transformation caméra × densité', () => {
    const { ctx, camera, renderer } = setup();
    renderer.resize(100, 100, 2);
    camera.offset = { x: 10, y: 20 };
    camera.zoom = 3;
    renderer.render();

    expect(ctx.setTransform).toHaveBeenLastCalledWith(6, 0, 0, 6, -60, -120);
  });

  it('signale un type sans fonction de dessin', () => {
    const { ctx, scene, renderer, flush } = setup();
    renderer.resize(100, 100);
    scene.upsert(item('x', 0, 0, 'inconnu'));
    flush();

    expect(ctx.strokeRect).toHaveBeenCalledWith(0, 0, 10, 10);
  });

  it('efface au lieu de peindre le fond quand il est transparent', () => {
    const { ctx, getContext, renderer } = setup(true);
    renderer.resize(100, 50);
    renderer.render();

    expect(getContext).toHaveBeenCalledWith('2d', { alpha: true });
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 100, 50);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('ne rend plus rien après dispose', () => {
    const { scene, renderer, frames } = setup();
    renderer.dispose();
    scene.upsert(item('a', 0, 0));

    expect(frames).toHaveLength(0);
  });
});

describe('gridSpacing', () => {
  it('garde un espacement écran au-dessus du minimum sans être trop large', () => {
    for (const zoom of [0.05, 0.1, 0.5, 1, 2, 7, 32]) {
      const screenSpacing = gridSpacing(zoom, 16) * zoom;
      expect(screenSpacing).toBeGreaterThanOrEqual(16);
      expect(screenSpacing).toBeLessThan(16 * 5);
    }
  });
});
