export {
  BoardDocument,
  type DocumentChange,
  DocumentError,
  type DocumentListener,
} from './document';
export { deleteObjectsOperations, moveObjectsOperations, resizePatch } from './edits';
export {
  ANCHORS,
  anchorPoint,
  arrowSize,
  type Box,
  CONNECTOR_LABEL_FONT_SIZE,
  connectorLabelBox,
  connectorPath,
  connectorSegment,
  distanceToSegment,
  endpointPosition,
  FRAME_TITLE_BAND,
  hitTestObject,
  nearestAnchor,
  objectBox,
  orthogonalRoute,
  type Point,
  pathMidpoint,
  polygonVertices,
  ROUTE_STUB,
  type Segment,
  simplifyPath,
} from './geometry';
export type { DocumentOperation, ObjectPatch } from './operations';
export {
  copyObjects,
  expandGroups,
  frameContents,
  groupOperations,
  pasteOperations,
  ungroupOperations,
  withFrameContents,
  zOrderOperations,
} from './structure';
export { equal, type RevertOptions, type RevertResult, UndoHistory } from './undo-history';
