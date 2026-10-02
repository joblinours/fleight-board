import {
  BoardDocument,
  type DocumentOperation,
  deleteObjectsOperations,
  hitTestObject,
  objectBox,
  type Point,
  type RevertResult,
  UndoHistory,
} from '@fleight/document';
import { type BoardObject, isShape } from '@fleight/protocol';
import { createId } from '@fleight/shared';
import { Camera } from '../camera';
import { attachDomInput } from '../input/dom-input';
import {
  type InputMode,
  InputRouter,
  type PointerKind,
  type PointerSample,
} from '../input/input-router';
import { CanvasRenderer, type Page, type ViewState } from '../renderer';
import { Scene } from '../scene';
import { HANDLE_SIZE_PX, HANDLES, handlePosition } from './handles';
import { boardPainters, createBoardPainters, type ImageSource } from './painters';
import type { BoardSceneItem } from './scene-items';
import { syncScene } from './scene-sync';
import { Selection } from './selection';
import { measureText } from './text-metrics';
import { ConnectorTool } from './tools/connector-tool';
import { EraserTool } from './tools/eraser-tool';
import { PenTool } from './tools/pen-tool';
import { PolygonTool } from './tools/polygon-tool';
import { SelectTool } from './tools/select-tool';
import { ShapeTool } from './tools/shape-tool';
import { TextTool } from './tools/text-tool';
import type { LockOwner, Tool, ToolContext, ToolName, ToolPoint, ToolStyle } from './tools/tool';

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
  apply(operations: DocumentOperation[], gesture?: GestureInfo, intent?: 'undo' | 'redo'): void;
  endGesture(gestureId: string): void;
};

/**
 * Verrous des objets en collaboration. Sans service (board local),
 * tout est modifiable.
 */
export type LockService = {
  /** Participant qui modifie l'objet, si ce n'est pas l'utilisateur local. */
  lockedBy(id: string): LockOwner | undefined;
  /** Objets modifiés par d'autres participants (indicateur visuel). */
  lockedByOthers(): Iterable<[string, LockOwner]>;
  acquire(ids: string[]): void;
  release(ids: string[]): void;
};

export type BoardEditorOptions = {
  /** Calque des objets. */
  sceneCanvas: HTMLCanvasElement;
  /** Calque d'interface superposé (sélection, aperçus) ; reçoit les entrées. */
  overlayCanvas: HTMLCanvasElement;
  document?: BoardDocument;
  sink?: OperationSink;
  locks?: LockService;
  /** Demande l'ouverture de l'éditeur de texte pour un objet. */
  onEditText?(id: string): void;
  onToolChange?(tool: ToolName): void;
  onSelectionChange?(ids: ReadonlySet<string>): void;
  /** Toute modification de la vue (pan, zoom, objets) : utile pour repositionner l'éditeur de texte. */
  onViewChange?(): void;
  /** Disponibilité de l'annulation et du rétablissement. */
  onHistoryChange?(state: { canUndo: boolean; canRedo: boolean }): void;
  /** Une annulation n'a pas pu tout restaurer (objets supprimés ou modifiés par d'autres). */
  onUndoSkipped?(result: RevertResult & { intent: 'undo' | 'redo' }): void;
  /** Page d'un canvas standard ; absente : canvas infini. */
  page?: Page;
  /** Contenu des objets `image` (chargé par l'application). */
  images?: ImageSource;
};

/**
 * Propriétés modifiables depuis le panneau de propriétés. Chacune s'applique aux
 * objets sélectionnés qui la possèdent, et devient le style des prochains objets.
 */
export type StyleChange = Partial<{
  /** Contour, connecteur, texte ou trait. */
  stroke: string;
  /** Remplissage des formes (`transparent` : sans remplissage). */
  fill: string;
  /** Épaisseur des contours et connecteurs, ou du trait à main levée. */
  strokeWidth: number;
  opacity: number;
  fontSize: number;
  arrowStart: boolean;
  arrowEnd: boolean;
}>;

/** Délai sans nouvelle modification après lequel un réglage (curseur…) est terminé. */
const STYLE_GESTURE_MS = 600;

/** Éditeur de whiteboard local : document, rendu, entrées, outils et sélection. */
export class BoardEditor {
  readonly document: BoardDocument;
  readonly selection = new Selection();
  readonly camera = new Camera();
  readonly router: InputRouter;
  readonly style: ToolStyle = {
    color: '#1f2937',
    fill: '#ffffff',
    strokeWidth: 2,
    penSize: 4,
    opacity: 1,
  };

  readonly #scene = new Scene<BoardSceneItem>();
  readonly #sceneRenderer: CanvasRenderer<BoardSceneItem>;
  readonly #overlayRenderer: CanvasRenderer<BoardSceneItem>;
  readonly #tools: Record<ToolName, Tool> = {
    select: new SelectTool(),
    rectangle: new ShapeTool('rectangle'),
    ellipse: new ShapeTool('ellipse'),
    polygon: new PolygonTool(),
    text: new TextTool(),
    connector: new ConnectorTool('connector'),
    line: new ConnectorTool('line'),
    arrow: new ConnectorTool('arrow'),
    pen: new PenTool('pen'),
    highlighter: new PenTool('highlighter'),
    eraser: new EraserTool(),
  };
  /** Réglage de propriétés en cours (curseur, couleur) : une seule action annulable. */
  #styleGesture:
    | { key: string; id: string; ids: string[]; timer: ReturnType<typeof setTimeout> }
    | undefined;
  readonly #options: BoardEditorOptions;
  readonly #modifiers = { shift: false };
  /** Historique d'annulation de l'utilisateur local uniquement. */
  readonly #history = new UndoHistory();
  readonly #cleanups: Array<() => void> = [];
  #tool: Tool;
  /** Geste en cours (entre pointer down et pointer up). */
  #gestureId: string | undefined;
  /** Objets verrouillés pour le geste en cours. */
  readonly #gestureLocks = new Set<string>();
  /** Objet verrouillé pendant l'édition de son texte. */
  #textLock: string | undefined;

  constructor(options: BoardEditorOptions) {
    this.#options = options;
    this.document = options.document ?? new BoardDocument();
    this.#tool = this.#tools.select;

    this.#sceneRenderer = new CanvasRenderer({
      canvas: options.sceneCanvas,
      scene: this.#scene,
      camera: this.camera,
      painters: createBoardPainters(options.images),
      ...(options.page ? { page: options.page } : {}),
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

  /** Applique des opérations locales ; elles entrent dans l'historique d'annulation. */
  apply(operations: DocumentOperation[]): void {
    if (!operations.length) return;
    const gestureId = this.#gestureId;
    this.#history.track(
      this.document,
      operations,
      () => this.#send(operations, gestureId),
      gestureId,
    );
    this.#notifyHistory();
  }

  /** Annule la dernière action de l'utilisateur local (pas celles des autres). */
  undo(): void {
    this.#revert('undo');
  }

  /** Rétablit la dernière action annulée. */
  redo(): void {
    this.#revert('redo');
  }

  get canUndo(): boolean {
    return this.#history.canUndo;
  }

  get canRedo(): boolean {
    return this.#history.canRedo;
  }

  #revert(intent: 'undo' | 'redo'): void {
    // Pas d'annulation au milieu d'un geste.
    if (this.#gestureId) return;
    const locks = this.#options.locks;
    const options = { blocked: (id: string) => locks?.lockedBy(id) !== undefined };
    const apply = (operations: DocumentOperation[]) => this.#send(operations, undefined, intent);
    const result =
      intent === 'undo'
        ? this.#history.undo(this.document, apply, options)
        : this.#history.redo(this.document, apply, options);
    if (result.skipped.length) this.#options.onUndoSkipped?.({ ...result, intent });
    this.#notifyHistory();
  }

  #send(operations: DocumentOperation[], gestureId?: string, intent?: 'undo' | 'redo'): void {
    const sink = this.#options.sink;
    if (!sink) {
      this.document.apply(operations);
      return;
    }
    sink.apply(operations, gestureId ? { id: gestureId, final: false } : undefined, intent);
  }

  #notifyHistory(): void {
    this.#options.onHistoryChange?.({ canUndo: this.canUndo, canRedo: this.canRedo });
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

  /** Supprime la sélection, sauf les objets modifiés par d'autres participants. */
  deleteSelection(): void {
    const locks = this.#options.locks;
    const ids = [...this.selection.ids].filter((id) => !locks?.lockedBy(id));
    this.apply(deleteObjectsOperations(this.document, ids));
  }

  /** Redessine l'interface (changement de verrous, de participants…). */
  refresh(): void {
    this.#overlayRenderer.requestRender();
  }

  /** Redessine les objets (une image vient de se charger…). */
  redraw(): void {
    this.#sceneRenderer.requestRender();
  }

  /** Objets sélectionnés. */
  selectedObjects(): BoardObject[] {
    return [...this.selection.ids]
      .map((id) => this.document.get(id))
      .filter((object): object is BoardObject => object !== undefined);
  }

  /**
   * Applique des propriétés aux objets sélectionnés (sauf ceux modifiés par
   * d'autres participants) et au style des prochains objets. Les réglages
   * successifs d'une même propriété forment une seule action annulable.
   */
  applyStyle(change: StyleChange): void {
    if (change.stroke !== undefined) this.style.color = change.stroke;
    if (change.fill !== undefined) this.style.fill = change.fill;
    if (change.strokeWidth !== undefined) this.style.strokeWidth = change.strokeWidth;
    if (change.opacity !== undefined) this.style.opacity = change.opacity;

    const locks = this.#options.locks;
    const operations: DocumentOperation[] = [];
    for (const object of this.selectedObjects()) {
      if (locks?.lockedBy(object.id)) continue;
      const patch = stylePatch(object, change);
      if (Object.keys(patch).length) operations.push({ kind: 'update', id: object.id, patch });
    }
    if (!operations.length) return;

    // Pendant un geste du pointeur, le réglage en fait partie.
    if (this.#gestureId) {
      this.apply(operations);
      return;
    }
    const key = Object.keys(change).sort().join(',');
    if (this.#styleGesture?.key !== key) this.#endStyleGesture();
    const ids = operations.map((operation) => (operation.kind === 'update' ? operation.id : ''));
    if (!this.#styleGesture) {
      locks?.acquire(ids);
      this.#styleGesture = { key, id: createId(), ids, timer: setTimeout(() => {}, 0) };
    }
    const gesture = this.#styleGesture;
    clearTimeout(gesture.timer);
    this.#gestureId = gesture.id;
    try {
      this.apply(operations);
    } finally {
      this.#gestureId = undefined;
    }
    gesture.timer = setTimeout(() => this.#endStyleGesture(), STYLE_GESTURE_MS);
  }

  #endStyleGesture(): void {
    const gesture = this.#styleGesture;
    if (!gesture) return;
    this.#styleGesture = undefined;
    clearTimeout(gesture.timer);
    this.#history.endGroup(gesture.id);
    this.#notifyHistory();
    this.#options.sink?.endGesture(gesture.id);
    this.#options.locks?.release(gesture.ids);
  }

  /**
   * Ajoute une image au centre de la vue, réduite pour tenir dans 60 % de l'écran,
   * et la sélectionne.
   */
  insertImage(image: { assetId: string; width: number; height: number }): string {
    const { width: viewWidth, height: viewHeight } = this.#sceneRenderer.viewport;
    const zoom = this.camera.zoom;
    const scale = Math.min(
      1,
      (viewWidth * 0.6) / zoom / image.width,
      (viewHeight * 0.6) / zoom / image.height,
    );
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const center = this.camera.screenToWorld({ x: viewWidth / 2, y: viewHeight / 2 });
    const id = createId();
    this.apply([
      {
        kind: 'create',
        object: {
          type: 'image',
          id,
          zIndex: this.document.topZIndex() + 1,
          x: Math.round(center.x - width / 2),
          y: Math.round(center.y - height / 2),
          width,
          height,
          assetId: image.assetId,
        },
      },
    ]);
    this.setTool('select');
    this.selection.set([id]);
    return id;
  }

  selectAll(): void {
    this.selection.set([...this.document.all()].map(({ id }) => id));
  }

  /** Page du canvas (standard) ; `undefined` : canvas infini. */
  setPage(page: Page | undefined): void {
    this.#sceneRenderer.page = page;
    this.#invalidate();
  }

  /** Cadre l'ensemble des objets, et la page d'un canvas standard. */
  fitContent(): void {
    const content = this.#scene.contentBounds();
    const page = this.#sceneRenderer.page;
    const pageBounds = page ? { minX: 0, minY: 0, maxX: page.width, maxY: page.height } : undefined;
    const bounds =
      content && pageBounds
        ? {
            minX: Math.min(content.minX, pageBounds.minX),
            minY: Math.min(content.minY, pageBounds.minY),
            maxX: Math.max(content.maxX, pageBounds.maxX),
            maxY: Math.max(content.maxY, pageBounds.maxY),
          }
        : (content ?? pageBounds);
    if (!bounds) return;
    const { width, height } = this.#sceneRenderer.viewport;
    this.camera.fitBounds(bounds, width, height, 96);
    this.#invalidate();
  }

  /** Enregistre le texte saisi pour un objet ; un texte vide est supprimé. */
  commitText(id: string, value: string): void {
    this.#releaseTextLock();
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
    } else if (isShape(object)) {
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
    if (isShape(object)) {
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
    this.#endStyleGesture();
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
      editText: (id) => this.#editText(id),
      lockedBy: (id) => this.#options.locks?.lockedBy(id),
      lock: (ids) => this.#lock(ids),
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

    this.#paintLocks(ctx, view);
    this.#tool.paint?.(ctx, view, this.#context);
  }

  /** Objets modifiés par d'autres participants : cadre et nom à leur couleur. */
  #paintLocks(ctx: CanvasRenderingContext2D, view: ViewState): void {
    const locks = this.#options.locks;
    if (!locks) return;
    const fontSize = 12 / view.zoom;
    ctx.save();
    ctx.lineWidth = 2 / view.zoom;
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (const [id, owner] of locks.lockedByOthers()) {
      const object = this.document.get(id);
      const box = object && objectBox(this.document, object);
      if (!box) continue;
      const margin = 4 / view.zoom;
      ctx.strokeStyle = owner.color;
      ctx.setLineDash([6 / view.zoom, 3 / view.zoom]);
      ctx.strokeRect(
        box.x - margin,
        box.y - margin,
        box.width + margin * 2,
        box.height + margin * 2,
      );

      const label = `✎ ${owner.name}`;
      const padding = 4 / view.zoom;
      const width = ctx.measureText(label).width + padding * 2;
      const height = fontSize + padding * 2;
      const x = box.x - margin;
      const y = box.y - margin - height;
      ctx.fillStyle = owner.color;
      ctx.fillRect(x, y, width, height);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, x + padding, y + height / 2);
    }
    ctx.restore();
  }

  #lock(ids: Iterable<string>): boolean {
    const locks = this.#options.locks;
    const list = [...ids];
    if (!locks) return true;
    if (list.some((id) => locks.lockedBy(id))) return false;
    const missing = list.filter((id) => !this.#gestureLocks.has(id));
    for (const id of missing) this.#gestureLocks.add(id);
    if (missing.length) locks.acquire(missing);
    return true;
  }

  #editText(id: string): void {
    const locks = this.#options.locks;
    if (locks?.lockedBy(id)) return;
    this.#releaseTextLock();
    if (locks) {
      this.#textLock = id;
      locks.acquire([id]);
    }
    this.#options.onEditText?.(id);
  }

  #releaseTextLock(): void {
    const id = this.#textLock;
    this.#textLock = undefined;
    // Le verrou peut aussi servir au geste en cours (double-tap pendant un glisser).
    if (id && !this.#gestureLocks.has(id)) this.#options.locks?.release([id]);
  }

  #endGesture(): void {
    const gestureId = this.#gestureId;
    this.#gestureId = undefined;
    if (gestureId) {
      this.#history.endGroup(gestureId);
      this.#notifyHistory();
      this.#options.sink?.endGesture(gestureId);
    }
    const released = [...this.#gestureLocks].filter((id) => id !== this.#textLock);
    this.#gestureLocks.clear();
    if (released.length) this.#options.locks?.release(released);
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
    // Saisie de texte en cours : les raccourcis sont laissés au champ. Un curseur,
    // une case à cocher ou un sélecteur de couleur (panneau de propriétés) ne bloquent rien.
    const textInputs = new Set(['text', 'search', 'email', 'password', 'number', 'url', 'tel']);
    const editing = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable || target.tagName === 'TEXTAREA') return true;
      return target instanceof HTMLInputElement && textInputs.has(target.type);
    };

    const shortcuts: Record<string, ToolName> = {
      v: 'select',
      r: 'rectangle',
      o: 'ellipse',
      g: 'polygon',
      t: 'text',
      c: 'connector',
      l: 'line',
      a: 'arrow',
      p: 'pen',
      h: 'highlighter',
      e: 'eraser',
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
      } else if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
      } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault();
        this.redo();
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

/** Propriétés d'un objet concernées par un changement de style. */
export function stylePatch(object: BoardObject, change: StyleChange): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (change.opacity !== undefined) patch.opacity = change.opacity;
  switch (object.type) {
    case 'rectangle':
    case 'ellipse':
    case 'polygon':
      if (change.stroke !== undefined) patch.stroke = change.stroke;
      if (change.fill !== undefined) patch.fill = change.fill;
      if (change.strokeWidth !== undefined) patch.strokeWidth = change.strokeWidth;
      break;
    case 'connector':
      if (change.stroke !== undefined) patch.stroke = change.stroke;
      if (change.strokeWidth !== undefined) patch.strokeWidth = Math.max(0.1, change.strokeWidth);
      if (change.arrowStart !== undefined) patch.arrowStart = change.arrowStart;
      if (change.arrowEnd !== undefined) patch.arrowEnd = change.arrowEnd;
      break;
    case 'text':
      if (change.stroke !== undefined) patch.color = change.stroke;
      if (change.fontSize !== undefined) {
        Object.assign(
          patch,
          { fontSize: change.fontSize },
          measureText(object.text, change.fontSize),
        );
      }
      break;
    case 'stroke':
      if (change.stroke !== undefined) patch.color = change.stroke;
      if (change.strokeWidth !== undefined) patch.size = Math.max(0.5, change.strokeWidth);
      break;
    case 'image':
      break;
  }
  return patch;
}
