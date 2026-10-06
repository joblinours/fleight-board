import { type BoardObject, BoardObjectSchema } from '@fleight/protocol';

/** En-tête du texte placé dans le presse-papiers système pour une copie d'objets. */
export const CLIPBOARD_PREFIX = 'fleight-board/objects@1\n';
/** Nombre maximal d'objets collés d'un coup. */
export const MAX_PASTED_OBJECTS = 5000;

/** Texte de presse-papiers d'une copie d'objets. */
export function serializeObjects(objects: readonly BoardObject[]): string {
  return CLIPBOARD_PREFIX + JSON.stringify(objects);
}

/**
 * Objets d'un texte de presse-papiers ; `undefined` si le texte n'en contient
 * pas ou s'il est invalide (il peut venir de n'importe où).
 */
export function parseObjects(text: string): BoardObject[] | undefined {
  if (!text.startsWith(CLIPBOARD_PREFIX)) return undefined;
  try {
    const parsed = BoardObjectSchema.array()
      .max(MAX_PASTED_OBJECTS)
      .safeParse(JSON.parse(text.slice(CLIPBOARD_PREFIX.length)));
    if (!parsed.success) return undefined;
    // Un identifiant en double ne donnerait qu'un seul objet collé.
    const seen = new Set<string>();
    return parsed.data.filter(({ id }) => !seen.has(id) && seen.add(id));
  } catch {
    return undefined;
  }
}
