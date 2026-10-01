import { describe, expect, it } from 'vitest';
import { Camera } from './camera';

describe('Camera', () => {
  it('convertit écran ↔ monde de façon réversible', () => {
    const camera = new Camera();
    camera.panBy(-120, 40);
    camera.zoomAt({ x: 300, y: 200 }, 2.5);

    const world = camera.screenToWorld({ x: 42, y: 17 });
    const screen = camera.worldToScreen(world);

    expect(screen.x).toBeCloseTo(42);
    expect(screen.y).toBeCloseTo(17);
  });

  it('garde le point sous le curseur fixe pendant le zoom', () => {
    const camera = new Camera();
    const anchor = { x: 250, y: 125 };
    const before = camera.screenToWorld(anchor);

    camera.zoomAt(anchor, 3);

    const after = camera.screenToWorld(anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('borne le zoom', () => {
    const camera = new Camera();
    camera.zoomAt({ x: 0, y: 0 }, 1e6);
    expect(camera.zoom).toBe(32);
    camera.zoomAt({ x: 0, y: 0 }, 1e-9);
    expect(camera.zoom).toBe(0.05);
  });

  it('déplace la vue en pixels écran quel que soit le zoom', () => {
    const camera = new Camera();
    camera.zoomAt({ x: 0, y: 0 }, 2);
    const before = camera.worldToScreen({ x: 10, y: 10 });

    camera.panBy(30, -20);

    const after = camera.worldToScreen({ x: 10, y: 10 });
    expect(after.x - before.x).toBeCloseTo(30);
    expect(after.y - before.y).toBeCloseTo(-20);
  });
});
