import type { Tool, ToolContext, ToolPoint } from './tool';

export const DEFAULT_FONT_SIZE = 24;

/** Crée un texte à l'endroit de l'appui et ouvre son édition. */
export class TextTool implements Tool {
  readonly name = 'text' as const;

  down(context: ToolContext, point: ToolPoint): void {
    const id = context.createId();
    context.apply([
      {
        kind: 'create',
        object: {
          type: 'text',
          id,
          zIndex: context.nextZIndex(),
          x: point.x,
          y: point.y - DEFAULT_FONT_SIZE / 2,
          width: 0,
          height: DEFAULT_FONT_SIZE * 1.25,
          text: '',
          fontSize: DEFAULT_FONT_SIZE,
          color: context.style.color,
        },
      },
    ]);
    context.selection.set([id]);
    context.setTool('select');
    context.editText(id);
  }

  move(): void {}
  up(): void {}
  cancel(): void {}
}
