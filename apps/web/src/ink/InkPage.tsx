import {
  attachDomInput,
  Camera,
  CanvasRenderer,
  type InputMode,
  InputRouter,
  type PointerKind,
  paintStroke,
  Scene,
  StrokeBuilder,
  type StrokeItem,
} from '@fleight/canvas';
import { useEffect, useRef, useState } from 'react';

const COLORS = ['#1f1f1f', '#2563eb', '#dc2626', '#16a34a', '#f59e0b'];
const MODES: Array<{ value: InputMode; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'pencil-only', label: 'Pencil seul' },
  { value: 'touch-drawing', label: 'Doigt dessine' },
];
const STATS_REFRESH_MS = 200;

type Tool = { color: string; size: number };

type Diagnostics = {
  pointerType: PointerKind | '—';
  pressure: number;
  tiltX: number;
  tiltY: number;
  /** Échantillons par seconde pendant le dernier trait. */
  sampleRate: number;
  /** Échantillons par événement (événements fusionnés). */
  samplesPerEvent: number;
  palmRejections: number;
  penDetected: boolean;
  strokes: number;
  lastStrokePoints: number;
};

const EMPTY_DIAGNOSTICS: Diagnostics = {
  pointerType: '—',
  pressure: 0,
  tiltX: 0,
  tiltY: 0,
  sampleRate: 0,
  samplesPerEvent: 0,
  palmRejections: 0,
  penDetected: false,
  strokes: 0,
  lastStrokePoints: 0,
};

type Engine = {
  router: InputRouter;
  undo(): void;
  clear(): void;
};

export function InkPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const toolRef = useRef<Tool>({ color: COLORS[0] ?? '#000', size: 4 });

  const [mode, setMode] = useState<InputMode>('auto');
  const modeRef = useRef(mode);
  const [tool, setTool] = useState<Tool>(toolRef.current);
  const [showDiagnostics, setShowDiagnostics] = useState(true);
  const [diagnostics, setDiagnostics] = useState<Diagnostics>(EMPTY_DIAGNOSTICS);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    modeRef.current = mode;
    if (engineRef.current) engineRef.current.router.mode = mode;
  }, [mode]);

  useEffect(() => {
    const container = containerRef.current;
    const sceneCanvas = sceneCanvasRef.current;
    const inkCanvas = inkCanvasRef.current;
    if (!container || !sceneCanvas || !inkCanvas) return;

    const camera = new Camera();
    const scene = new Scene<StrokeItem>();
    // Calque dédié au trait en cours : seul lui est redessiné pendant le tracé.
    const live = new Scene<StrokeItem>();
    const painters = { stroke: paintStroke };
    const sceneRenderer = new CanvasRenderer({ canvas: sceneCanvas, scene, camera, painters });
    const liveRenderer = new CanvasRenderer({
      canvas: inkCanvas,
      scene: live,
      camera,
      painters,
      transparent: true,
      grid: false,
    });
    const requestRender = () => {
      sceneRenderer.requestRender();
      liveRenderer.requestRender();
    };

    const stats: Diagnostics = { ...EMPTY_DIAGNOSTICS };
    const history: string[] = [];
    let zIndex = 0;
    let builder: StrokeBuilder | null = null;
    let strokeStart = 0;
    let strokeSamples = 0;
    let strokeEvents = 0;

    const addSample = (x: number, y: number, pressure: number) => {
      if (!builder) return;
      const world = camera.screenToWorld({ x, y });
      builder.add(world.x, world.y, pressure);
    };

    const router = new InputRouter(
      {
        drawStart(pointer, sample) {
          const { color, size } = toolRef.current;
          builder = new StrokeBuilder(
            {
              color,
              // Taille choisie en pixels écran, convertie en unités monde.
              size: size / camera.zoom,
              opacity: 1,
              simulatePressure: pointer.kind !== 'pen',
            },
            zIndex++,
            0.5 / camera.zoom,
          );
          strokeStart = sample.time;
          strokeSamples = 1;
          strokeEvents = 1;
          addSample(sample.x, sample.y, sample.pressure);
          live.upsert(builder.item());
        },
        drawMove(_pointer, samples) {
          if (!builder) return;
          strokeEvents++;
          strokeSamples += samples.length;
          for (const sample of samples) addSample(sample.x, sample.y, sample.pressure);
          const lastSample = samples[samples.length - 1];
          if (lastSample && lastSample.time > strokeStart) {
            stats.sampleRate = (strokeSamples * 1000) / (lastSample.time - strokeStart);
          }
          stats.samplesPerEvent = strokeSamples / strokeEvents;
          live.upsert(builder.item());
        },
        drawEnd() {
          if (!builder) return;
          const item = builder.item(true);
          live.remove(item.id);
          scene.upsert(item);
          history.push(item.id);
          stats.strokes = scene.size;
          stats.lastStrokePoints = builder.pointCount;
          builder = null;
        },
        drawCancel() {
          if (builder) live.remove(builder.id);
          builder = null;
        },
        pan(dx, dy) {
          camera.panBy(dx, dy);
          requestRender();
        },
        zoom(anchor, factor) {
          camera.zoomAt(anchor, factor);
          requestRender();
        },
        palmRejected() {
          stats.palmRejections++;
        },
      },
      modeRef.current,
    );

    const detach = attachDomInput(inkCanvas, router, {
      onWheelPan(dx, dy) {
        camera.panBy(dx, dy);
        requestRender();
      },
      onWheelZoom(anchor, factor) {
        camera.zoomAt(anchor, factor);
        requestRender();
      },
      onRawEvent(event) {
        // La pression du levé vaut 0 : on garde la dernière valeur utile.
        if (event.type === 'pointerup') return;
        stats.pointerType = event.pointerType === '' ? '—' : (event.pointerType as PointerKind);
        stats.pressure = event.pressure;
        stats.tiltX = event.tiltX;
        stats.tiltY = event.tiltY;
        stats.penDetected = router.penDetected;
      },
    });

    engineRef.current = {
      router,
      undo() {
        const id = history.pop();
        if (id) scene.remove(id);
        stats.strokes = scene.size;
      },
      clear() {
        history.length = 0;
        scene.load([]);
        stats.strokes = 0;
      },
    };

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const ratio = window.devicePixelRatio || 1;
      sceneRenderer.resize(width, height, ratio);
      liveRenderer.resize(width, height, ratio);
    });
    resizeObserver.observe(container);

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        engineRef.current?.undo();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    const statsTimer = window.setInterval(() => setDiagnostics({ ...stats }), STATS_REFRESH_MS);

    return () => {
      window.clearInterval(statsTimer);
      window.removeEventListener('keydown', onKeyDown);
      resizeObserver.disconnect();
      detach();
      sceneRenderer.dispose();
      liveRenderer.dispose();
      engineRef.current = null;
    };
    // Le moteur est créé une seule fois ; le mode et l'outil sont lus via des refs.
  }, []);

  return (
    <div className="ink" ref={containerRef}>
      <canvas ref={sceneCanvasRef} className="ink-layer" />
      <canvas ref={inkCanvasRef} className="ink-layer" />

      <div className="ink-toolbar">
        <select
          aria-label="Mode de saisie"
          value={mode}
          onChange={(event) => setMode(event.target.value as InputMode)}
        >
          {MODES.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="ink-colors">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Couleur ${color}`}
              className={color === tool.color ? 'selected' : ''}
              style={{ background: color }}
              onClick={() => setTool({ ...tool, color })}
            />
          ))}
        </div>
        <input
          aria-label="Épaisseur"
          type="range"
          min={1}
          max={32}
          value={tool.size}
          onChange={(event) => setTool({ ...tool, size: Number(event.target.value) })}
        />
        <button type="button" onClick={() => engineRef.current?.undo()}>
          Annuler
        </button>
        <button type="button" onClick={() => engineRef.current?.clear()}>
          Effacer
        </button>
        <button type="button" onClick={() => setShowDiagnostics(!showDiagnostics)}>
          Diag.
        </button>
        <a href="#/">Accueil</a>
      </div>

      {showDiagnostics && (
        <dl className="ink-diagnostics">
          <dt>Pointeur</dt>
          <dd>{diagnostics.pointerType}</dd>
          <dt>Pression</dt>
          <dd>{diagnostics.pressure.toFixed(3)}</dd>
          <dt>Inclinaison</dt>
          <dd>
            {diagnostics.tiltX}° / {diagnostics.tiltY}°
          </dd>
          <dt>Échantillons</dt>
          <dd>{Math.round(diagnostics.sampleRate)} Hz</dd>
          <dt>Fusionnés</dt>
          <dd>{diagnostics.samplesPerEvent.toFixed(1)} / évt</dd>
          <dt>Stylet détecté</dt>
          <dd>{diagnostics.penDetected ? 'oui' : 'non'}</dd>
          <dt>Paumes ignorées</dt>
          <dd>{diagnostics.palmRejections}</dd>
          <dt>Traits</dt>
          <dd>{diagnostics.strokes}</dd>
          <dt>Points (dernier)</dt>
          <dd>{diagnostics.lastStrokePoints}</dd>
        </dl>
      )}
    </div>
  );
}
