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
  connectorSegment,
  distanceToSegment,
  endpointPosition,
  hitTestObject,
  nearestAnchor,
  objectBox,
  type Point,
  polygonVertices,
  type Segment,
} from './geometry';
export type { DocumentOperation, ObjectPatch } from './operations';
export { equal, type RevertOptions, type RevertResult, UndoHistory } from './undo-history';
