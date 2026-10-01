import {
  BoardDocument,
  type DocumentOperation,
  deleteObjectsOperations,
  hitTestObject,
  objectBox,
  type Point,
} from '@fleight/document';
import type { BoardObject } from '@fleight/protocol';
import { createId } from '@fleight/shared';
import { Camera } from '../camera';
import { attachDomInput } from '../input/dom-input';
import {
  type InputMode,
  InputRouter,
  type PointerKind,
  type PointerSample,
} from '../input/input-router';
import { CanvasRenderer, type ViewState } from '../renderer';
import { Scene } from '../scene';
import { HANDLE_SIZE_PX, HANDLES, handlePosition } from './handles';
import { boardPainters } from './painters';
import type { BoardSceneItem } from './scene-items';
import { syncScene } from './scene-sync';
import { Selection } from './selection';
import { measureText } from './text-metrics';
import { ConnectorTool } from './tools/connector-tool';
import { PenTool } from './tools/pen-tool';
import { SelectTool } from './tools/select-tool';
import { ShapeTool } from './tools/shape-tool';
import { TextTool } from './tools/text-tool';
import type { Tool, ToolContext, ToolName, ToolPoint, ToolStyle } from './tools/tool';

/** Tolérance de contact à l'écran, en pixels, selon le pointeur. */
const TOLERANCE_PX: Record<PointerKind, number> = { mouse: 4, pen: 6, touch: 12 };
const SELECTION_COLOR = '#2563eb';

/** Geste en cours : ses lots d'opérations sont regroupés côté collaboration. */
export type GestureInfo = { id: string; final: boolean };

/**
 * Destination des opérations locales. Par défaut, elles sont appliquées
 * directement au document ; en collaboration, le client les applique et les envoie.
 */
export type OperationSink = {
  apply(operations: DocumentOperation[], gesture?: GestureInfo): void;
  endGesture(gestureId: string): void;
};

export type BoardEditorOptions = {
  /** Calque des objets. */
  sceneCanvas: HTMLCanvasElement;
  /** Calque d'interface superposé (sélection, aperçus) ; reçoit les entrées. */
  overlayCanvas: HTMLCanvasElement;
  document?: BoardDocument;
  sink?: OperationSink;
  /** Demande l'ouverture de l'éditeur de texte pour un objet. */
  onEditText?(id: string): void;
  onToolChange?(tool: ToolName): void;
  onSelectionChange?(ids: ReadonlySet<string>): void;
  /** Toute modification de la vue (pan, zoom, objets) : utile pour repositionner l'éditeur de texte. */
  onViewChange?(): void;
};

/** Éditeur de whiteboard local : document, rendu, entrées, outils et sélection. */
export class BoardEditor {
  readonly document: BoardDocument;
  readonly selection = new Selection();
  readonly camera = new Camera();
  readonly router: InputRouter;
  readonly style: ToolStyle = { color: '#1f2937', fill: '#ffffff', strokeWidth: 2, penSize: 4 };

  readonly #scene = new Scene<BoardSceneItem>();
  readonly #sceneRenderer: CanvasRenderer<BoardSceneItem>;
  readonly #overlayRenderer: CanvasRenderer<BoardSceneItem>;
  readonly #tools: Record<ToolName, Tool> = {
    select: new SelectTool(),
    rectangle: new ShapeTool('rectangle'),
    ellipse: new ShapeTool('ellipse'),
    text: new TextTool(),
    connector: new ConnectorTool(),
    pen: new PenTool(),
  };
  readonly #options: BoardEditorOptions;
  readonly #modifiers = { shift: false };
  readonly #cleanups: Array<() => void> = [];
  #tool: Tool;
  /** Geste en cours (entre pointer down et pointer up). */
  #gestureId: string | undefined;

  constructor(options: BoardEditorOptions) {
    this.#options = options;
    this.document = options.document ?? new BoardDocument();
    this.#tool = this.#tools.select;

    this.#sceneRenderer = new CanvasRenderer({
      canvas: options.sceneCanvas,
      scene: this.#scene,
      camera: this.camera,
      painters: boardPainters,
    });
    this.#overlayRenderer = new CanvasRenderer({
      canvas: options.overlayCanvas,
      scene: new Scene<BoardSceneItem>(),
      camera: this.camera,
      painters: boardPainters,
      transparent: true,
      grid: false,
      overlay: (ctx, view) => this.#paintOverlay(ctx, view),
    });

    this.#cleanups.push(syncScene(this.document, this.#scene));
    this.#cleanups.push(
      this.document.subscribe((change) => {
        // Un objet supprimé (par soi ou par un autre) quitte la sélection.
        if (change.deleted.length) {
          const deleted = new Set(change.deleted.map(({ id }) => id));
          this.selection.set([...this.selection.ids].filter((id) => !deleted.has(id)));
        }
        this.#invalidate();
      }),
    );
    this.#cleanups.push(
      this.selection.subscribe((ids) => {
        this.#overlayRenderer.requestRender();
        options.onSelectionChange?.(ids);
      }),
    );

    const toWorld = (sample: PointerSample): ToolPoint => ({
      ...this.camera.screenToWorld(sample),
      pressure: sample.pressure,
      time: sample.time,
    });
    this.router = new InputRouter({
      drawStart: (pointer, sample) => {
        this.#gestureId = createId();
        this.#tool.down(this.#context, toWorld(sample), pointer.kind);
      },
      drawMove: (_pointer, samples) => this.#tool.move(this.#context, samples.map(toWorld)),
      drawEnd: () => {
        this.#tool.up(this.#context);
        this.#endGesture();
      },
      drawCancel: () => {
        this.#tool.cancel(this.#context);
        this.#endGesture();
      },
      pan: (dx, dy) => this.#panBy(dx, dy),
      zoom: (anchor, factor) => this.#zoomAt(anchor, factor),
    });

    this.#cleanups.push(
      attachDomInput(options.overlayCanvas, this.router, {
        onWheelPan: (dx, dy) => this.#panBy(dx, dy),
        onWheelZoom: (anchor, factor) => this.#zoomAt(anchor, factor),
      }),
    );
    this.#cleanups.push(this.#attachKeyboard());
  }

  get tool(): ToolName {
    return this.#tool.name;
  }

  set inputMode(mode: InputMode) {
    this.router.mode = mode;
  }

  setTool(name: ToolName): void {
    if (this.#tool.name === name) return;
    this.#tool.cancel(this.#context);
    this.#tool = this.#tools[name];
    if (name !== 'select') this.selection.clear();
    this.#overlayRenderer.requestRender();
    this.#options.onToolChange?.(name);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.#sceneRenderer.resize(width, height, pixelRatio);
    this.#overlayRenderer.resize(width, height, pixelRatio);
    this.#options.onViewChange?.();
  }

  apply(operations: DocumentOperation[]): void {
    if (!operations.length) return;
    const sink = this.#options.sink;
    if (!sink) {
      this.document.apply(operations);
      return;
    }
    const gestureId = this.#gestureId;
    sink.apply(operations, gestureId ? { id: gestureId, final: false } : undefined);
  }

  /** Remplace tout le contenu du board (exemple, import) en un seul lot. */
  replaceContent(objects: BoardObject[]): void {
    this.selection.clear();
    this.apply([
      ...deleteObjectsOperations(
        this.document,
        [...this.document.all()].map(({ id }) => id),
      ),
      ...objects.map((object) => ({ kind: 'create' as const, object })),
    ]);
  }

  deleteSelection(): void {
    this.apply(deleteObjectsOperations(this.document, this.selection.ids));
  }

  selectAll(): void {
    this.selection.set([...this.document.all()].map(({ id }) => id));
  }

  /** Cadre l'ensemble des objets. */
  fitContent(): void {
    const bounds = this.#scene.contentBounds();
    if (!bounds) return;
    const { width, height } = this.#sceneRenderer.viewport;
    this.camera.fitBounds(bounds, width, height, 96);
    this.#invalidate();
  }

  /** Enregistre le texte saisi pour un objet ; un texte vide est supprimé. */
  commitText(id: string, value: string): void {
    const object = this.document.get(id);
    if (!object) return;
    if (object.type === 'text') {
      if (!value.trim()) {
        this.apply([{ kind: 'delete', id }]);
        return;
      }
      if (value === object.text && object.width > 0) return;
      this.apply([
        { kind: 'update', id, patch: { text: value, ...measureText(value, object.fontSize) } },
      ]);
    } else if (object.type === 'rectangle' || object.type === 'ellipse') {
      if (value !== object.label) this.apply([{ kind: 'update', id, patch: { label: value } }]);
    }
  }

  /** Position à l'écran (pixels CSS) de la zone de texte d'un objet. */
  textEditorFrame(id: string):
    | {
        x: number;
        y: number;
        width: number;
        height: number;
        fontSize: number;
        text: string;
        align: 'left' | 'center';
      }
    | undefined {
    const object = this.document.get(id);
    if (!object) return undefined;
    const zoom = this.camera.zoom;
    if (object.type === 'text') {
      const origin = this.camera.worldToScreen(object);
      return {
        ...origin,
        width: Math.max(object.width * zoom, 120),
        height: Math.max(object.height * zoom, object.fontSize * 1.25 * zoom),
        fontSize: object.fontSize * zoom,
        text: object.text,
        align: 'left',
      };
    }
    if (object.type === 'rectangle' || object.type === 'ellipse') {
      const origin = this.camera.worldToScreen(object);
      return {
        ...origin,
        width: object.width * zoom,
        height: object.height * zoom,
        fontSize: 16 * zoom,
        text: object.label,
        align: 'center',
      };
    }
    return undefined;
  }

  dispose(): void {
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
    this.#sceneRenderer.dispose();
    this.#overlayRenderer.dispose();
  }

  get #context(): ToolContext {
    return {
      document: this.document,
      selection: this.selection,
      style: this.style,
      zoom: this.camera.zoom,
      modifiers: this.#modifiers,
      tolerance: (kind) => TOLERANCE_PX[kind] / this.camera.zoom,
      hitTest: (point, tolerance, filter) => this.#hitTest(point, tolerance, filter),
      apply: (operations) => this.apply(operations),
      nextZIndex: () => this.document.topZIndex() + 1,
      createId,
      editText: (id) => this.#options.onEditText?.(id),
      setTool: (name) => this.setTool(name),
      invalidate: () => this.#overlayRenderer.requestRender(),
    };
  }

  #hitTest(
    point: Point,
    tolerance: number,
    filter?: (object: BoardObject) => boolean,
  ): BoardObject | undefined {
    for (const item of this.#scene.hitTest(point, tolerance)) {
      const object = item.object;
      if (filter && !filter(object)) continue;
      if (hitTestObject(this.document, object, point, tolerance)) return object;
    }
    return undefined;
  }

  #paintOverlay(ctx: CanvasRenderingContext2D, view: ViewState): void {
    ctx.save();
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1.5 / view.zoom;
    const singleId = this.selection.single();

    for (const id of this.selection.ids) {
      const object = this.document.get(id);
      if (!object) continue;
      const item = this.#scene.get(id);
      if (object.type === 'connector') {
        if (item?.segment) {
          for (const point of [item.segment.start, item.segment.end]) {
            paintHandle(ctx, point, view.zoom, 'circle');
          }
        }
        continue;
      }
      const box = objectBox(this.document, object);
      if (!box) continue;
      ctx.setLineDash([]);
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      if (id === singleId) {
        for (const handle of HANDLES)
          paintHandle(ctx, handlePosition(box, handle), view.zoom, 'square');
      }
    }
    ctx.restore();

    this.#tool.paint?.(ctx, view, this.#context);
  }

  #endGesture(): void {
    const gestureId = this.#gestureId;
    this.#gestureId = undefined;
    if (gestureId) this.#options.sink?.endGesture(gestureId);
  }

  #panBy(dx: number, dy: number): void {
    this.camera.panBy(dx, dy);
    this.#invalidate();
  }

  #zoomAt(anchor: Point, factor: number): void {
    this.camera.zoomAt(anchor, factor);
    this.#invalidate();
  }

  #invalidate(): void {
    this.#sceneRenderer.requestRender();
    this.#overlayRenderer.requestRender();
    this.#options.onViewChange?.();
  }

  #attachKeyboard(): () => void {
    const editing = (event: KeyboardEvent) =>
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName));

    const shortcuts: Record<string, ToolName> = {
      v: 'select',
      r: 'rectangle',
      o: 'ellipse',
      t: 'text',
      c: 'connector',
      p: 'pen',
    };

    const onKeyDown = (event: KeyboardEvent) => {
      this.#modifiers.shift = event.shiftKey;
      if (editing(event) || this.router.isDrawing) return;
      const key = event.key.toLowerCase();
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        this.deleteSelection();
      } else if (key === 'escape') {
        this.selection.clear();
        this.setTool('select');
      } else if ((event.ctrlKey || event.metaKey) && key === 'a') {
        event.preventDefault();
        this.selectAll();
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const tool = shortcuts[key];
        if (tool) this.setTool(tool);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      this.#modifiers.shift = event.shiftKey;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }
}

function paintHandle(
  ctx: CanvasRenderingContext2D,
  point: Point,
  zoom: number,
  shape: 'square' | 'circle',
) {
  const size = HANDLE_SIZE_PX / zoom;
  ctx.beginPath();
  if (shape === 'square') ctx.rect(point.x - size / 2, point.y - size / 2, size, size);
  else ctx.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.stroke();
}
