import type { Bounds, Camera, CanvasRenderer, SceneItem } from '@fleight/canvas';
import { type FrameSummary, summarizeFrames } from './frame-stats';

export type BenchmarkOptions<T extends SceneItem> = {
  camera: Camera;
  renderer: CanvasRenderer<T>;
  content: Bounds;
  durationMs: number;
};

/**
 * Parcours scripté reproductible : part d'une vue d'ensemble (tout le contenu
 * visible, le pire cas), zoome jusqu'à ×8 en décrivant un cercle, puis revient.
 * Le rendu est fait dans la frame elle-même pour mesurer le coût réel.
 */
export function runBenchmark<T extends SceneItem>({
  camera,
  renderer,
  content,
  durationMs,
}: BenchmarkOptions<T>): Promise<FrameSummary> {
  const { width, height } = renderer.viewport;
  camera.fitBounds(content, width, height);
  const baseZoom = camera.zoom;
  const centerX = (content.minX + content.maxX) / 2;
  const centerY = (content.minY + content.maxY) / 2;
  const radius = Math.min(content.maxX - content.minX, content.maxY - content.minY) / 4;

  const intervals: number[] = [];
  const renderTimes: number[] = [];

  return new Promise((resolve) => {
    let start: number | undefined;
    let previous: number | undefined;

    const frame = (time: number) => {
      start ??= time;
      if (previous !== undefined) intervals.push(time - previous);
      previous = time;

      const progress = Math.min((time - start) / durationMs, 1);
      const angle = progress * Math.PI * 2;
      camera.zoom = baseZoom * 2 ** (3 * Math.sin(progress * Math.PI));
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      camera.offset = { x: x - width / 2 / camera.zoom, y: y - height / 2 / camera.zoom };

      renderer.render();
      renderTimes.push(renderer.stats.renderMs);

      if (progress < 1) requestAnimationFrame(frame);
      else resolve(summarizeFrames(intervals, renderTimes));
    };
    requestAnimationFrame(frame);
  });
}
