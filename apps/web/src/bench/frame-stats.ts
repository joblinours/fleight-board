export type FrameSummary = {
  frames: number;
  /** Images par seconde moyennes. */
  averageFps: number;
  /** 95e percentile de la durée entre deux frames, en ms (les saccades). */
  p95FrameMs: number;
  /** Durée moyenne du rendu lui-même, en ms. */
  averageRenderMs: number;
  /** Proportion de frames au-delà de 1,5 × la durée cible (frames « perdues »). */
  droppedRatio: number;
};

/**
 * Résume un enregistrement de frames.
 * `intervals` : durée entre deux frames successives ; `renderTimes` : durée de chaque rendu.
 */
export function summarizeFrames(
  intervals: readonly number[],
  renderTimes: readonly number[],
  targetFrameMs = 1000 / 60,
): FrameSummary {
  if (intervals.length === 0) {
    return { frames: 0, averageFps: 0, p95FrameMs: 0, averageRenderMs: 0, droppedRatio: 0 };
  }
  const total = intervals.reduce((sum, value) => sum + value, 0);
  const sorted = [...intervals].sort((a, b) => a - b);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  const dropped = intervals.filter((value) => value > targetFrameMs * 1.5).length;
  const renderTotal = renderTimes.reduce((sum, value) => sum + value, 0);

  return {
    frames: intervals.length,
    averageFps: (intervals.length * 1000) / total,
    p95FrameMs: sorted[p95Index] ?? 0,
    averageRenderMs: renderTimes.length ? renderTotal / renderTimes.length : 0,
    droppedRatio: dropped / intervals.length,
  };
}
