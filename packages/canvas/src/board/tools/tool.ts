import type { BoardDocument, DocumentOperation, Point } from '@fleight/document';
import type { BoardObject } from '@fleight/protocol';
import type { PointerKind } from '../../input/input-router';
import type { ViewState } from '../../renderer';
import type { Selection } from '../selection';

export type ToolName = 'select' | 'rectangle' | 'ellipse' | 'text' | 'connector' | 'pen';

/** Point d'un geste, en coordonnées monde. */
export type ToolPoint = Point & { pressure: number; time: number };

export type ToolStyle = {
  /** Couleur des contours, connecteurs, textes et traits. */
  color: string;
  fill: string;
  strokeWidth: number;
  /** Épaisseur du stylo, en pixels écran. */
  penSize: number;
};

/** Services fournis aux outils par l'éditeur. */
export type ToolContext = {
  readonly document: BoardDocument;
  readonly selection: Selection;
  readonly style: ToolStyle;
  /** Facteur de zoom courant. */
  readonly zoom: number;
  /** Tolérance de contact en unités monde (plus large au doigt qu'à la souris). */
  tolerance(kind: PointerKind): number;
  /** Objet le plus haut sous un point, avec test précis. */
  hitTest(
    point: Point,
    tolerance: number,
    filter?: (object: BoardObject) => boolean,
  ): BoardObject | undefined;
  apply(operations: DocumentOperation[]): void;
  nextZIndex(): number;
  createId(): string;
  /** Ouvre l'édition du texte ou du label d'un objet. */
  editText(id: string): void;
  setTool(name: ToolName): void;
  /** Le calque d'interface (sélection, aperçus) doit être redessiné. */
  invalidate(): void;
  readonly modifiers: { shift: boolean };
};

export type Tool = {
  readonly name: ToolName;
  down(context: ToolContext, point: ToolPoint, kind: PointerKind): void;
  move(context: ToolContext, points: readonly ToolPoint[]): void;
  up(context: ToolContext): void;
  cancel(context: ToolContext): void;
  /** Aperçus propres à l'outil, dessinés en coordonnées monde sur le calque d'interface. */
  paint?(ctx: CanvasRenderingContext2D, view: ViewState, context: ToolContext): void;
};
