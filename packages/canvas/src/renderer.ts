import type { Camera } from './camera';
import type { Bounds } from './geometry';
import type { Scene, SceneItem } from './scene';

export type ViewState = {
  /** Facteur de zoom courant (pixels écran par unité monde). */
  zoom: number;
  /** Zone du monde visible. */
  visible: Bounds;
};

/** Dessine un élément d'un type donné. Le contexte est déjà transformé en coordonnées monde. */
export type ItemPainter<T extends SceneItem> = (
  ctx: CanvasRenderingContext2D,
  item: T,
  view: ViewState,
) => void;

export type RenderStats = {
  /** Durée du dernier rendu, en millisecondes. */
  renderMs: number;
  /** Nombre d'éléments dessinés au dernier rendu. */
  drawnItems: number;
  /** Nombre total de rendus effectués. */
  frames: number;
};

export type GridOptions = {
  color: string;
  /** Espacement minimal entre deux lignes, en pixels écran. */
  minSpacing: number;
};

export type RendererOptions<T extends SceneItem> = {
  canvas: HTMLCanvasElement;
  scene: Scene<T>;
  camera: Camera;
  painters: Record<string, ItemPainter<T>>;
  /** Couleur de fond ; ignorée si `transparent`. */
  background?: string;
  /** Canvas transparent, à superposer à un autre (calque du trait en cours). */
  transparent?: boolean;
  grid?: GridOptions | false;
  /** Planification d'une frame ; injectable pour les tests. */
  scheduleFrame?: (callback: () => void) => void;
  /** Horloge en millisecondes ; injectable pour les tests. */
  now?: () => number;
  onRender?: (stats: RenderStats) => void;
};

const DEFAULT_GRID: GridOptions = { color: 'rgba(128, 128, 128, 0.15)', minSpacing: 16 };
const GRID_BASE = 10;
const GRID_STEP = 5;

/**
 * Rendu Canvas 2D à la demande : rien n'est redessiné tant que la scène,
 * la caméra ou la taille du canvas ne changent pas.
 */
export class CanvasRenderer<T extends SceneItem = SceneItem> {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #scene: Scene<T>;
  readonly #camera: Camera;
  readonly #painters: Record<string, ItemPainter<T>>;
  readonly #background: string | null;
  readonly #grid: GridOptions | false;
  readonly #scheduleFrame: (callback: () => void) => void;
  readonly #now: () => number;
  readonly #onRender: ((stats: RenderStats) => void) | undefined;
  readonly #unsubscribe: () => void;

  #width = 0;
  #height = 0;
  #pixelRatio = 1;
  #pending = false;
  #disposed = false;
  #stats: RenderStats = { renderMs: 0, drawnItems: 0, frames: 0 };

  constructor(options: RendererOptions<T>) {
    const transparent = options.transparent ?? false;
    const ctx = options.canvas.getContext('2d', { alpha: transparent });
    if (!ctx) throw new Error('Canvas 2D indisponible');

    this.#canvas = options.canvas;
    this.#ctx = ctx;
    this.#scene = options.scene;
    this.#camera = options.camera;
    this.#painters = options.painters;
    this.#background = transparent ? null : (options.background ?? '#ffffff');
    this.#grid = options.grid === undefined ? DEFAULT_GRID : options.grid;
    this.#scheduleFrame = options.scheduleFrame ?? ((callback) => requestAnimationFrame(callback));
    this.#now = options.now ?? (() => performance.now());
    this.#onRender = options.onRender;
    this.#unsubscribe = this.#scene.subscribe(() => this.requestRender());
  }

  get stats(): RenderStats {
    return this.#stats;
  }

  /** Taille du viewport en pixels CSS. */
  get viewport(): { width: number; height: number } {
    return { width: this.#width, height: this.#height };
  }

  /** Adapte la résolution du canvas à sa taille affichée et à la densité de l'écran. */
  resize(cssWidth: number, cssHeight: number, pixelRatio = 1): void {
    this.#width = cssWidth;
    this.#height = cssHeight;
    this.#pixelRatio = pixelRatio;
    this.#canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
    this.#canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
    this.requestRender();
  }

  /** Demande un rendu à la prochaine frame ; les demandes multiples sont fusionnées. */
  requestRender(): void {
    if (this.#pending || this.#disposed) return;
    this.#pending = true;
    this.#scheduleFrame(() => {
      this.#pending = false;
      if (!this.#disposed) this.render();
    });
  }

  /** Rendu immédiat. */
  render(): void {
    const start = this.#now();
    const ctx = this.#ctx;
    const camera = this.#camera;
    const ratio = this.#pixelRatio;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.#background === null) {
      ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    } else {
      ctx.fillStyle = this.#background;
      ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
    }

    const view: ViewState = {
      zoom: camera.zoom,
      visible: camera.visibleBounds(this.#width, this.#height),
    };

    // Coordonnées monde → pixels physiques.
    const scale = ratio * camera.zoom;
    ctx.setTransform(scale, 0, 0, scale, -camera.offset.x * scale, -camera.offset.y * scale);

    if (this.#grid) this.#drawGrid(this.#grid, view);

    const items = this.#scene.query(view.visible);
    for (const item of items) {
      const painter = this.#painters[item.kind];
      if (painter) painter(ctx, item, view);
      else drawMissingPainter(ctx, item, view);
    }

    this.#stats = {
      renderMs: this.#now() - start,
      drawnItems: items.length,
      frames: this.#stats.frames + 1,
    };
    this.#onRender?.(this.#stats);
  }

  dispose(): void {
    this.#disposed = true;
    this.#unsubscribe();
  }

  #drawGrid(grid: GridOptions, view: ViewState): void {
    const spacing = gridSpacing(view.zoom, grid.minSpacing);
    const { minX, minY, maxX, maxY } = view.visible;
    const ctx = this.#ctx;

    ctx.beginPath();
    for (let x = Math.floor(minX / spacing) * spacing; x <= maxX; x += spacing) {
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
    for (let y = Math.floor(minY / spacing) * spacing; y <= maxY; y += spacing) {
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.strokeStyle = grid.color;
    ctx.lineWidth = 1 / view.zoom;
    ctx.stroke();
  }
}

/**
 * Espacement de la grille en unités monde : 10, 50, 250… ou 2, 0.4…
 * choisi pour rester au-dessus de `minSpacing` pixels à l'écran.
 */
export function gridSpacing(zoom: number, minSpacing: number): number {
  let spacing = GRID_BASE;
  while (spacing * zoom < minSpacing) spacing *= GRID_STEP;
  while ((spacing / GRID_STEP) * zoom >= minSpacing) spacing /= GRID_STEP;
  return spacing;
}

function drawMissingPainter(ctx: CanvasRenderingContext2D, item: SceneItem, view: ViewState) {
  const { minX, minY, maxX, maxY } = item.bounds;
  ctx.setLineDash([4 / view.zoom, 4 / view.zoom]);
  ctx.strokeStyle = '#e5484d';
  ctx.lineWidth = 1 / view.zoom;
  ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
  ctx.setLineDash([]);
}
