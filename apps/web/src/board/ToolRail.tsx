import type { ToolName } from '@fleight/canvas';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../ui/Icon';

export type ToolSpec = { name: ToolName; label: string; key: string; icon: IconName };

const TOOLS: Record<ToolName, ToolSpec> = {
  select: { name: 'select', label: 'Sélection', key: 'V', icon: 'pointer' },
  lasso: { name: 'lasso', label: 'Lasso', key: 'Q', icon: 'lasso' },
  pen: { name: 'pen', label: 'Stylo', key: 'P', icon: 'pen' },
  highlighter: { name: 'highlighter', label: 'Surligneur', key: 'H', icon: 'highlighter' },
  eraser: { name: 'eraser', label: 'Gomme', key: 'E', icon: 'eraser' },
  rectangle: { name: 'rectangle', label: 'Rectangle', key: 'R', icon: 'square' },
  ellipse: { name: 'ellipse', label: 'Ellipse', key: 'O', icon: 'circle' },
  polygon: { name: 'polygon', label: 'Polygone', key: 'G', icon: 'pentagon' },
  text: { name: 'text', label: 'Texte', key: 'T', icon: 'type' },
  line: { name: 'line', label: 'Ligne', key: 'L', icon: 'line' },
  arrow: { name: 'arrow', label: 'Flèche', key: 'A', icon: 'arrow' },
  connector: { name: 'connector', label: 'Connecteur', key: 'C', icon: 'connector' },
  frame: { name: 'frame', label: 'Frame', key: 'F', icon: 'frame' },
};

/**
 * Barre d'outils, par sections. En mode compact (tablette, écran peu haut), les
 * outils d'une même famille partagent un bouton qui déplie les autres.
 */
const SECTIONS: ToolName[][][] = [
  [['select', 'lasso']],
  [['pen'], ['highlighter'], ['eraser']],
  [['rectangle', 'ellipse', 'polygon'], ['text'], ['line', 'arrow', 'connector'], ['frame']],
];

/** Tous les outils, dans l'ordre de la barre (aide des raccourcis). */
export const ALL_TOOLS: ToolSpec[] = SECTIONS.flat(2).map((name) => TOOLS[name]);

export function ToolRail({
  tool,
  compact,
  canEdit,
  onSelect,
  extra,
}: {
  tool: ToolName;
  compact: boolean;
  /** Lecture seule : seule la sélection reste. */
  canEdit: boolean;
  onSelect: (tool: ToolName) => void;
  /** Section supplémentaire (import d'image). */
  extra?: ReactNode;
}) {
  // Outil affiché par chaque famille : le dernier choisi.
  const [chosen, setChosen] = useState<Partial<Record<string, ToolName>>>({});
  const [open, setOpen] = useState<string | null>(null);
  const railRef = useRef<HTMLElement>(null);

  // Outil choisi au clavier : sa famille l'affiche.
  useEffect(() => {
    const family = SECTIONS.flat().find((names) => names.includes(tool));
    if (family && family.length > 1) {
      const id = family[0] as string;
      setChosen((current) => (current[id] === tool ? current : { ...current, [id]: tool }));
    }
  }, [tool]);

  // Un appui ailleurs referme le menu déplié.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!railRef.current?.contains(event.target as Node)) setOpen(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const pick = (name: ToolName) => {
    setOpen(null);
    onSelect(name);
  };

  const button = (spec: ToolSpec, extraClass = '', onClick = () => pick(spec.name)) => (
    <button
      key={spec.name}
      type="button"
      className={`tool-button${tool === spec.name ? ' active' : ''}${extraClass}`}
      title={`${spec.label} (${spec.key})`}
      aria-label={spec.label}
      aria-pressed={tool === spec.name}
      onClick={onClick}
    >
      <Icon name={spec.icon} size={19} />
    </button>
  );

  return (
    <nav
      ref={railRef}
      className={`editor-toolrail${compact ? ' compact' : ''}`}
      aria-label="Outils"
    >
      {SECTIONS.map((section) => {
        const families = section
          .map((family) => family.filter((name) => canEdit || name === 'select'))
          .filter((family) => family.length > 0);
        if (!families.length) return null;
        return (
          <div key={families[0]?.[0]} className="toolrail-group">
            {families.flatMap((family) => {
              if (!compact || family.length === 1) return family.map((name) => button(TOOLS[name]));
              const id = family[0] as ToolName;
              const shown = TOOLS[chosen[id] ?? id];
              const active = family.includes(tool);
              return [
                <div key={id} className="tool-family">
                  {button(shown, ' has-family', () => {
                    // Premier appui : l'outil de la famille ; appui suivant : les autres.
                    if (active) setOpen(open === id ? null : id);
                    else pick(shown.name);
                  })}
                  {open === id && (
                    <div className="tool-flyout" role="menu" aria-label={`Outils : ${shown.label}`}>
                      {family.map((name) =>
                        button(TOOLS[name], '', () => {
                          setChosen((current) => ({ ...current, [id]: name }));
                          pick(name);
                        }),
                      )}
                    </div>
                  )}
                </div>,
              ];
            })}
          </div>
        );
      })}
      {extra && <div className="toolrail-group">{extra}</div>}
    </nav>
  );
}
