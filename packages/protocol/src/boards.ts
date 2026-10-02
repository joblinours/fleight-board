import { z } from 'zod';
import { BoardIdSchema } from './session';

/**
 * Code court d'un board : 6 caractères, majuscules et chiffres, sans les
 * caractères ambigus `O 0 I 1 S 5`.
 */
export const BOARD_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
export const BoardCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCDEFGHJKLMNPQRTUVWXYZ2346789]{6}$/, 'Code à 6 caractères');

/** Formats standard, en unités monde (96 par pouce pour les formats papier). */
export const STANDARD_FORMATS = {
  A4: { width: 794, height: 1123 },
  A3: { width: 1123, height: 1587 },
  A2: { width: 1587, height: 2245 },
  '16:9': { width: 1920, height: 1080 },
  '4:3': { width: 1600, height: 1200 },
} as const;
export type StandardFormat = keyof typeof STANDARD_FORMATS;

const dimension = z.number().int().min(100).max(20_000);

/** Surface du board : page de taille fixe, ou canvas infini. */
export const BoardCanvasSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('infinite') }),
  z.object({
    kind: z.literal('standard'),
    format: z.enum(['A4', 'A3', 'A2', '16:9', '4:3', 'custom']),
    width: dimension,
    height: dimension,
  }),
]);
export type BoardCanvas = z.infer<typeof BoardCanvasSchema>;

/** Page d'un format standard ; sans orientation, celle du format (papier : portrait). */
export function standardCanvas(
  format: StandardFormat,
  orientation?: 'portrait' | 'landscape',
): BoardCanvas {
  const { width, height } = STANDARD_FORMATS[format];
  const natural = height >= width ? 'portrait' : 'landscape';
  const swap = orientation !== undefined && orientation !== natural;
  return {
    kind: 'standard',
    format,
    width: swap ? height : width,
    height: swap ? width : height,
  };
}

export const BoardNameSchema = z
  .string()
  .trim()
  .min(1, 'Nom requis')
  .max(80, 'Au plus 80 caractères');
export const BoardDescriptionSchema = z.string().trim().max(500, 'Au plus 500 caractères');

export const BoardSummarySchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  canvas: BoardCanvasSchema,
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  /** Masqué de la liste de son propriétaire. */
  hidden: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BoardSummary = z.infer<typeof BoardSummarySchema>;

export const CreateBoardRequestSchema = z.object({
  name: BoardNameSchema,
  description: BoardDescriptionSchema.default(''),
  canvas: BoardCanvasSchema.default({ kind: 'infinite' }),
  /** Identifiant choisi (lien lisible) ; généré sinon. */
  id: BoardIdSchema.optional(),
});
export type CreateBoardRequest = z.input<typeof CreateBoardRequestSchema>;

export const UpdateBoardRequestSchema = z
  .object({ name: BoardNameSchema, description: BoardDescriptionSchema, hidden: z.boolean() })
  .partial();
export type UpdateBoardRequest = z.infer<typeof UpdateBoardRequestSchema>;

export const BoardResponseSchema = z.object({ board: BoardSummarySchema });
export type BoardResponse = z.infer<typeof BoardResponseSchema>;

export const BoardsResponseSchema = z.object({ boards: z.array(BoardSummarySchema) });
export type BoardsResponse = z.infer<typeof BoardsResponseSchema>;
