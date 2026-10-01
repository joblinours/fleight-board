import { z } from 'zod';

const coordinate = z.number().finite().min(-1e7).max(1e7);
const length = z.number().finite().min(0).max(1e7);
const color = z.string().min(1).max(32);

export const ObjectIdSchema = z.string().min(1).max(64);

const base = {
  id: ObjectIdSchema,
  /** Ordre d'affichage : les valeurs hautes sont au-dessus. */
  zIndex: z.number().finite(),
};

/** Objet occupant un rectangle (x, y = coin haut-gauche, en coordonnées monde). */
const boxed = {
  ...base,
  x: coordinate,
  y: coordinate,
  width: length,
  height: length,
};

const shape = {
  ...boxed,
  fill: color,
  stroke: color,
  strokeWidth: z.number().finite().min(0).max(100),
  /** Texte centré dans la forme (« Firewall »…). */
  label: z.string().max(1000),
};

export const RectangleSchema = z.object({ type: z.literal('rectangle'), ...shape });
export const EllipseSchema = z.object({ type: z.literal('ellipse'), ...shape });

export const TextSchema = z.object({
  type: z.literal('text'),
  ...boxed,
  text: z.string().max(10_000),
  fontSize: z.number().finite().min(4).max(1000),
  color,
});

export const StrokeSchema = z.object({
  type: z.literal('stroke'),
  ...boxed,
  /** Triplets aplatis [x, y, pression], relatifs au coin (x, y) de l'objet. */
  points: z
    .array(z.number().finite())
    .max(60_000)
    .refine((points) => points.length % 3 === 0, 'Les points vont par triplets [x, y, pression]'),
  color,
  /** Épaisseur de base, en unités monde. */
  size: z.number().finite().min(0.01).max(1000),
  opacity: z.number().min(0).max(1),
  simulatePressure: z.boolean(),
});

export const AnchorSchema = z.enum(['top', 'right', 'bottom', 'left']);

export const EndpointSchema = z.discriminatedUnion('kind', [
  /** Extrémité accrochée à un objet : elle le suit quand il bouge. */
  z.object({ kind: z.literal('object'), objectId: ObjectIdSchema, anchor: AnchorSchema }),
  /** Extrémité libre. */
  z.object({ kind: z.literal('point'), x: coordinate, y: coordinate }),
]);

export const ConnectorSchema = z.object({
  type: z.literal('connector'),
  ...base,
  start: EndpointSchema,
  end: EndpointSchema,
  stroke: color,
  strokeWidth: z.number().finite().min(0.1).max(100),
  arrowStart: z.boolean(),
  arrowEnd: z.boolean(),
});

export const BoardObjectSchema = z.discriminatedUnion('type', [
  RectangleSchema,
  EllipseSchema,
  TextSchema,
  StrokeSchema,
  ConnectorSchema,
]);

export type RectangleObject = z.infer<typeof RectangleSchema>;
export type EllipseObject = z.infer<typeof EllipseSchema>;
export type TextObject = z.infer<typeof TextSchema>;
export type StrokeObject = z.infer<typeof StrokeSchema>;
export type ConnectorObject = z.infer<typeof ConnectorSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;
export type Endpoint = z.infer<typeof EndpointSchema>;
export type BoardObject = z.infer<typeof BoardObjectSchema>;
export type BoardObjectType = BoardObject['type'];

/** Objets occupant un rectangle (tout sauf les connecteurs). */
export type BoxedObject = Exclude<BoardObject, ConnectorObject>;
/** Formes pouvant porter un label et recevoir des connecteurs dédiés. */
export type ShapeObject = RectangleObject | EllipseObject;

export function isBoxed(object: BoardObject): object is BoxedObject {
  return object.type !== 'connector';
}

export function isShape(object: BoardObject): object is ShapeObject {
  return object.type === 'rectangle' || object.type === 'ellipse';
}
