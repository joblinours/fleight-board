import type { BoardEditor, StyleChange, ToolName } from '@fleight/canvas';
import type { BoardObject } from '@fleight/protocol';
import { useState } from 'react';
import { Icon, type IconName } from '../ui/Icon';

const COLORS = ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#7c3aed', '#ffffff'];
const FILLS = ['transparent', '#ffffff', '#dbeafe', '#fee2e2', '#dcfce7', '#fef3c7', '#ede9fe'];
const FONT_SIZES = [12, 16, 20, 24, 32, 48, 64, 96];

type Field = 'stroke' | 'fill' | 'strokeWidth' | 'opacity' | 'fontSize' | 'arrows' | 'routing';

/** Propriétés réglables par type d'objet. */
const FIELDS: Record<BoardObject['type'], Field[]> = {
  rectangle: ['stroke', 'fill', 'strokeWidth', 'opacity'],
  ellipse: ['stroke', 'fill', 'strokeWidth', 'opacity'],
  polygon: ['stroke', 'fill', 'strokeWidth', 'opacity'],
  text: ['stroke', 'fontSize', 'opacity'],
  connector: ['stroke', 'strokeWidth', 'arrows', 'routing', 'opacity'],
  stroke: ['stroke', 'strokeWidth', 'opacity'],
  image: ['opacity'],
  frame: ['fill', 'opacity'],
};

/** Sans sélection : propriétés des objets que l'outil va créer. */
const TOOL_FIELDS: Partial<Record<ToolName, Field[]>> = {
  rectangle: FIELDS.rectangle,
  ellipse: FIELDS.ellipse,
  polygon: FIELDS.polygon,
  text: ['stroke'],
  connector: ['stroke', 'strokeWidth', 'routing', 'opacity'],
  line: ['stroke', 'strokeWidth', 'opacity'],
  arrow: ['stroke', 'strokeWidth', 'opacity'],
  pen: ['stroke', 'strokeWidth', 'opacity'],
  highlighter: ['stroke', 'strokeWidth'],
};

/** Valeurs affichées : celles du premier objet sélectionné, sinon le style courant. */
function currentValues(editor: BoardEditor, object: BoardObject | undefined) {
  const style = editor.style;
  const values = {
    stroke: style.color,
    fill: style.fill,
    strokeWidth: style.strokeWidth,
    opacity: style.opacity,
    fontSize: 24,
    arrowStart: false,
    arrowEnd: true,
    routing: style.routing,
  };
  if (!object) return values;
  values.opacity = object.opacity ?? 1;
  switch (object.type) {
    case 'rectangle':
    case 'ellipse':
    case 'polygon':
      return {
        ...values,
        stroke: object.stroke,
        fill: object.fill,
        strokeWidth: object.strokeWidth,
      };
    case 'connector':
      return {
        ...values,
        stroke: object.stroke,
        strokeWidth: object.strokeWidth,
        arrowStart: object.arrowStart,
        arrowEnd: object.arrowEnd,
        routing: object.routing ?? 'straight',
      };
    case 'text':
      return { ...values, stroke: object.color, fontSize: object.fontSize };
    case 'stroke':
      return { ...values, stroke: object.color, strokeWidth: object.size };
    case 'frame':
      return { ...values, fill: object.fill };
    default:
      return values;
  }
}

/**
 * Panneau de propriétés : couleur, remplissage, épaisseur, opacité, taille du
 * texte, pointes de flèche. Agit sur la sélection, ou sur le style des prochains
 * objets quand rien n'est sélectionné.
 */
export function PropertiesPanel({ editor, tool }: { editor: BoardEditor | null; tool: ToolName }) {
  // Re-rendu après un réglage (les valeurs sont lues dans l'éditeur).
  const [, setVersion] = useState(0);
  if (!editor) return null;
  const objects = editor.selectedObjects();
  const fields = new Set<Field>(
    objects.length ? objects.flatMap((object) => FIELDS[object.type]) : (TOOL_FIELDS[tool] ?? []),
  );
  const showActions = objects.length > 0 || (tool === 'select' && editor.canPaste);
  if (!fields.size && !showActions) return null;
  const values = currentValues(editor, objects[0]);
  const penTool = !objects.length && (tool === 'pen' || tool === 'highlighter');

  const apply = (change: StyleChange) => {
    editor.applyStyle(change);
    setVersion((version) => version + 1);
  };
  const width = penTool ? editor.style.penSize : values.strokeWidth;
  const setWidth = (value: number) => {
    if (penTool) {
      editor.style.penSize = value;
      setVersion((version) => version + 1);
    } else {
      apply({ strokeWidth: value });
    }
  };

  /** Action sur la sélection, puis re-rendu (Coller, Grouper… changent de disponibilité). */
  const act = (action: () => void) => {
    action();
    setVersion((version) => version + 1);
  };
  const copy = (cut: boolean) => {
    const text = cut ? editor.cutSelection() : editor.copySelection();
    // Aussi dans le presse-papiers système, pour coller dans un autre board.
    if (text) void navigator.clipboard?.writeText(text).catch(() => {});
  };

  return (
    <aside className="properties" aria-label="Propriétés">
      {showActions && (
        <div className="properties-actions" role="toolbar" aria-label="Actions sur la sélection">
          {objects.length > 0 && (
            <>
              <ActionButton
                icon="copy"
                label="Copier (Ctrl/⌘+C)"
                onClick={() => act(() => copy(false))}
              />
              <ActionButton
                icon="scissors"
                label="Couper (Ctrl/⌘+X)"
                onClick={() => act(() => copy(true))}
              />
            </>
          )}
          <ActionButton
            icon="clipboard"
            label="Coller (Ctrl/⌘+V)"
            disabled={!editor.canPaste}
            onClick={() => act(() => editor.paste())}
          />
          {objects.length > 0 && (
            <>
              <ActionButton
                icon="duplicate"
                label="Dupliquer (Ctrl/⌘+D)"
                onClick={() => act(() => editor.duplicate())}
              />
              <ActionButton
                icon="group"
                label="Grouper (Ctrl/⌘+G)"
                disabled={!editor.canGroup}
                onClick={() => act(() => editor.group())}
              />
              <ActionButton
                icon="ungroup"
                label="Dégrouper (Ctrl/⌘+Maj+G)"
                disabled={!editor.canUngroup}
                onClick={() => act(() => editor.ungroup())}
              />
              <ActionButton
                icon="bringFront"
                label="Premier plan (Ctrl/⌘+])"
                onClick={() => act(() => editor.bringToFront())}
              />
              <ActionButton
                icon="sendBack"
                label="Arrière-plan (Ctrl/⌘+[)"
                onClick={() => act(() => editor.sendToBack())}
              />
            </>
          )}
        </div>
      )}
      {fields.has('stroke') && (
        <Row label={objects.some(({ type }) => type === 'text') ? 'Couleur' : 'Trait'}>
          <Swatches colors={COLORS} value={values.stroke} onPick={(stroke) => apply({ stroke })} />
          <input
            type="color"
            aria-label="Autre couleur"
            value={values.stroke.startsWith('#') ? values.stroke.slice(0, 7) : '#000000'}
            onChange={(event) => apply({ stroke: event.target.value })}
          />
        </Row>
      )}
      {fields.has('fill') && (
        <Row label="Remplissage">
          <Swatches colors={FILLS} value={values.fill} onPick={(fill) => apply({ fill })} />
        </Row>
      )}
      {fields.has('strokeWidth') && (
        <Row label={`Épaisseur ${Math.round(width)}`}>
          <input
            type="range"
            min={1}
            max={penTool ? 40 : 20}
            value={width}
            onChange={(event) => setWidth(Number(event.target.value))}
          />
        </Row>
      )}
      {fields.has('fontSize') && (
        <Row label="Taille">
          <select
            value={values.fontSize}
            onChange={(event) => apply({ fontSize: Number(event.target.value) })}
          >
            {[...new Set([...FONT_SIZES, Math.round(values.fontSize)])]
              .sort((a, b) => a - b)
              .map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
          </select>
        </Row>
      )}
      {fields.has('arrows') && (
        <Row label="Pointes">
          <label>
            <input
              type="checkbox"
              checked={values.arrowStart}
              onChange={(event) => apply({ arrowStart: event.target.checked })}
            />{' '}
            début
          </label>
          <label>
            <input
              type="checkbox"
              checked={values.arrowEnd}
              onChange={(event) => apply({ arrowEnd: event.target.checked })}
            />{' '}
            fin
          </label>
        </Row>
      )}
      {fields.has('routing') && (
        <Row label="Tracé">
          <select
            aria-label="Tracé du connecteur"
            value={values.routing}
            onChange={(event) =>
              apply({ routing: event.target.value as 'straight' | 'orthogonal' })
            }
          >
            <option value="orthogonal">Orthogonal</option>
            <option value="straight">Droit</option>
          </select>
        </Row>
      )}
      {fields.has('opacity') && (
        <Row label={`Opacité ${Math.round(values.opacity * 100)} %`}>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={Math.round(values.opacity * 100)}
            onChange={(event) => apply({ opacity: Number(event.target.value) / 100 })}
          />
        </Row>
      )}
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="board-property">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Swatches({
  colors,
  value,
  onPick,
}: {
  colors: string[];
  value: string;
  onPick: (color: string) => void;
}) {
  return (
    <>
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color === 'transparent' ? 'Sans remplissage' : `Couleur ${color}`}
          className={`board-swatch${color === value ? ' selected' : ''}${color === 'transparent' ? ' none' : ''}`}
          style={color === 'transparent' ? undefined : { background: color }}
          onClick={() => onPick(color)}
        />
      ))}
    </>
  );
}

/** Action sur la sélection : bouton-icône avec infobulle. */
function ActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="tool-button small"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={17} />
    </button>
  );
}
