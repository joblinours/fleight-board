export {
  BoardEditor,
  type BoardEditorOptions,
  type GestureInfo,
  type LockService,
  type OperationSink,
} from './board/editor';
export { HANDLES, type Handle, handleAt, handlePosition, resizeBox } from './board/handles';
export { boardPainters } from './board/painters';
export { type BoardSceneItem, toSceneItem } from './board/scene-items';
export { syncScene } from './board/scene-sync';
export { Selection, type SelectionListener } from './board/selection';
export type {
  LockOwner,
  Tool,
  ToolContext,
  ToolName,
  ToolPoint,
  ToolStyle,
} from './board/tools/tool';
export { Camera, MAX_ZOOM, MIN_ZOOM } from './camera';
export {
  type Bounds,
  boundsFromRect,
  containsPoint,
  expand,
  intersects,
  type Point,
} from './geometry';
export {
  outlineToPath,
  paintStroke,
  type StrokeItem,
  type StrokeStyle,
  strokeBounds,
  strokeOutline,
} from './ink/stroke';
export { StrokeBuilder } from './ink/stroke-builder';
export { attachDomInput, type DomInputOptions, pointerKind } from './input/dom-input';
export {
  type DrawingPointer,
  type InputHandlers,
  type InputMode,
  InputRouter,
  PEN_COOLDOWN_MS,
  type PointerInput,
  type PointerKind,
  type PointerSample,
} from './input/input-router';
export {
  CanvasRenderer,
  type GridOptions,
  gridSpacing,
  type ItemPainter,
  type Page,
  type RendererOptions,
  type RenderStats,
  type ViewState,
} from './renderer';
export { Scene, type SceneItem, type SceneListener } from './scene';
export { SpatialIndex } from './spatial-index';
