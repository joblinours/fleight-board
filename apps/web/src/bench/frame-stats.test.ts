import { describe, expect, it } from 'vitest';
import { summarizeFrames } from './frame-stats';

describe('summarizeFrames', () => {
  it('retourne des zéros sans frame', () => {
    expect(summarizeFrames([], []).averageFps).toBe(0);
  });

  it('calcule fps moyen, p95 et frames perdues', () => {
    const intervals = [...Array.from({ length: 95 }, () => 1000 / 60), 50, 50, 50, 50, 50];
    const summary = summarizeFrames(intervals, [2, 4]);

    expect(summary.frames).toBe(100);
    expect(summary.averageFps).toBeCloseTo(100_000 / (95 * (1000 / 60) + 250));
    expect(summary.p95FrameMs).toBeCloseTo(1000 / 60);
    expect(summary.droppedRatio).toBeCloseTo(0.05);
    expect(summary.averageRenderMs).toBe(3);
  });
});
