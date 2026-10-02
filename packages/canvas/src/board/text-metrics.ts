import { FONT_FAMILY, LINE_HEIGHT } from './painters';

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Taille d'un texte multiligne, en unités monde. */
export function measureText(text: string, fontSize: number): { width: number; height: number } {
  // Hors navigateur (tests, serveur) : estimation à partir du nombre de caractères.
  measureContext ??=
    typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  const lines = text.split('\n');
  let width = 0;
  if (measureContext) {
    measureContext.font = `${fontSize}px ${FONT_FAMILY}`;
    for (const line of lines) width = Math.max(width, measureContext.measureText(line).width);
  } else {
    width = Math.max(...lines.map((line) => line.length)) * fontSize * 0.6;
  }
  return { width: Math.ceil(width), height: Math.ceil(lines.length * fontSize * LINE_HEIGHT) };
}
