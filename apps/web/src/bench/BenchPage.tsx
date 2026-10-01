import { Camera, CanvasRenderer, type RenderStats, Scene } from '@fleight/canvas';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameSummary } from './frame-stats';
import { benchPainters } from './painters';
import { runBenchmark } from './run-benchmark';
import { type BenchShape, generateShapes } from './scene-generator';

const COUNTS = [1_000, 5_000, 10_000, 20_000];
const BENCHMARK_DURATION_MS = 6_000;
const STATS_REFRESH_MS = 250;

type Engine = {
  scene: Scene<BenchShape>;
  camera: Camera;
  renderer: CanvasRenderer<BenchShape>;
  /** Recadrer dès que le viewport a une taille (premier resize ou nouvelle scène). */
  fitPending: boolean;
};

function fitEngine(engine: Engine): void {
  const content = engine.scene.contentBounds();
  const { width, height } = engine.renderer.viewport;
  if (!content || width === 0 || height === 0) {
    engine.fitPending = true;
    return;
  }
  engine.fitPending = false;
  engine.camera.fitBounds(content, width, height);
  engine.renderer.requestRender();
}

export function BenchPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [count, setCount] = useState(5_000);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<(FrameSummary & { count: number }) | null>(null);

  // Création du moteur et des interactions de base (pan à la souris/au doigt, molette).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new Scene<BenchShape>();
    const camera = new Camera();
    let latestStats: RenderStats | null = null;
    const renderer = new CanvasRenderer<BenchShape>({
      canvas,
      scene,
      camera,
      painters: benchPainters,
      background: '#fafafa',
      onRender: (next) => {
        latestStats = next;
      },
    });
    const engine: Engine = { scene, camera, renderer, fitPending: true };
    engineRef.current = engine;

    const statsTimer = window.setInterval(() => setStats(latestStats), STATS_REFRESH_MS);

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      renderer.resize(width, height, window.devicePixelRatio || 1);
      if (engine.fitPending) fitEngine(engine);
    });
    resizeObserver.observe(canvas);

    let drag: { pointerId: number; x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (drag) return;
      canvas.setPointerCapture(event.pointerId);
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      camera.panBy(event.clientX - drag.x, event.clientY - drag.y);
      drag = { ...drag, x: event.clientX, y: event.clientY };
      renderer.requestRender();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (drag?.pointerId === event.pointerId) drag = null;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (event.ctrlKey || event.metaKey) {
        // Pinch du trackpad (ctrlKey) ou Cmd/Ctrl + molette.
        camera.zoomAt(anchor, Math.exp(-event.deltaY * 0.01));
      } else {
        camera.panBy(-event.deltaX, -event.deltaY);
      }
      renderer.requestRender();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      window.clearInterval(statsTimer);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      renderer.dispose();
      engineRef.current = null;
    };
  }, []);

  const fit = useCallback(() => {
    if (engineRef.current) fitEngine(engineRef.current);
  }, []);

  // (Re)génération de la scène quand le nombre d'objets change.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.scene.load(generateShapes(count));
    setResult(null);
    fitEngine(engine);
  }, [count]);

  const startBenchmark = async () => {
    const engine = engineRef.current;
    const content = engine?.scene.contentBounds();
    if (!engine || !content) return;
    setRunning(true);
    setResult(null);
    const summary = await runBenchmark({
      camera: engine.camera,
      renderer: engine.renderer,
      content,
      durationMs: BENCHMARK_DURATION_MS,
    });
    setResult({ ...summary, count });
    setRunning(false);
    fit();
  };

  return (
    <div className="bench">
      <canvas ref={canvasRef} className="bench-canvas" />
      <aside className="bench-panel">
        <h1>Benchmark du rendu</h1>
        <label>
          Objets{' '}
          <select
            value={count}
            disabled={running}
            onChange={(event) => setCount(Number(event.target.value))}
          >
            {COUNTS.map((value) => (
              <option key={value} value={value}>
                {value.toLocaleString('fr-FR')}
              </option>
            ))}
          </select>
        </label>
        <div className="bench-actions">
          <button type="button" onClick={fit} disabled={running}>
            Recadrer
          </button>
          <button type="button" onClick={startBenchmark} disabled={running}>
            {running ? 'Mesure en cours…' : 'Lancer le benchmark (6 s)'}
          </button>
        </div>
        <dl>
          <dt>Rendu CPU</dt>
          <dd>{stats ? `${stats.renderMs.toFixed(1)} ms` : '—'}</dd>
          <dt>Dessinés</dt>
          <dd>{stats ? stats.drawnItems.toLocaleString('fr-FR') : '—'}</dd>
          <dt>Densité</dt>
          <dd>×{window.devicePixelRatio}</dd>
        </dl>
        {result && (
          <section>
            <h2>Résultat ({result.count.toLocaleString('fr-FR')} objets)</h2>
            <dl>
              <dt>FPS moyen</dt>
              <dd className={result.averageFps >= 55 ? 'ok' : 'ko'}>
                {result.averageFps.toFixed(1)}
              </dd>
              <dt>Frame p95</dt>
              <dd>{result.p95FrameMs.toFixed(1)} ms</dd>
              <dt>Rendu CPU moyen</dt>
              <dd>{result.averageRenderMs.toFixed(1)} ms</dd>
              <dt>Frames perdues</dt>
              <dd>{(result.droppedRatio * 100).toFixed(1)} %</dd>
            </dl>
          </section>
        )}
        <p className="bench-help">
          Glisser pour déplacer · molette pour défiler · Ctrl/⌘ + molette ou pinch trackpad pour
          zoomer. Le pinch tactile arrive avec M0.3 ; sur iPad, utilisez le benchmark scripté.
        </p>
        <a href="#/">← Accueil</a>
      </aside>
    </div>
  );
}
