import { BoardEditor, type InputMode, type ToolName } from '@fleight/canvas';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sampleDiagram } from './sample-diagram';

const TOOLS: Array<{ name: ToolName; label: string; key: string }> = [
  { name: 'select', label: 'Sélection', key: 'V' },
  { name: 'rectangle', label: 'Rectangle', key: 'R' },
  { name: 'ellipse', label: 'Ellipse', key: 'O' },
  { name: 'text', label: 'Texte', key: 'T' },
  { name: 'connector', label: 'Connecteur', key: 'C' },
  { name: 'pen', label: 'Stylo', key: 'P' },
];
const COLORS = ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#f59e0b'];

export function BoardPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<BoardEditor | null>(null);

  const [tool, setTool] = useState<ToolName>('select');
  const [selectionSize, setSelectionSize] = useState(0);
  const [color, setColor] = useState(COLORS[0] ?? '#000');
  const [mode, setMode] = useState<InputMode>('auto');
  const [editingId, setEditingId] = useState<string | null>(null);
  // Incrémenté à chaque changement de vue pour repositionner l'éditeur de texte.
  const [viewVersion, setViewVersion] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const sceneCanvas = sceneCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!container || !sceneCanvas || !overlayCanvas) return;

    const editor = new BoardEditor({
      sceneCanvas,
      overlayCanvas,
      onEditText: setEditingId,
      onToolChange: setTool,
      onSelectionChange: (ids) => setSelectionSize(ids.size),
      onViewChange: () => setViewVersion((version) => version + 1),
    });
    editorRef.current = editor;

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      editor.resize(width, height, window.devicePixelRatio || 1);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (editorRef.current) editorRef.current.inputMode = mode;
  }, [mode]);

  useEffect(() => {
    if (editorRef.current) editorRef.current.style.color = color;
  }, [color]);

  // Focus de la zone de texte à l'ouverture de l'édition.
  useEffect(() => {
    if (!editingId) return;
    const textarea = textareaRef.current;
    textarea?.focus();
    textarea?.select();
  }, [editingId]);

  const commitText = useCallback(() => {
    const editor = editorRef.current;
    const textarea = textareaRef.current;
    if (editor && editingId && textarea) editor.commitText(editingId, textarea.value);
    setEditingId(null);
  }, [editingId]);

  const loadSample = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.document.load(sampleDiagram());
    editor.selection.clear();
    editor.fitContent();
  };

  const frame = editingId ? editorRef.current?.textEditorFrame(editingId) : undefined;
  void viewVersion;

  return (
    <div className="board" ref={containerRef}>
      <canvas ref={sceneCanvasRef} className="board-layer" />
      <canvas ref={overlayCanvasRef} className="board-layer" />

      {frame && editingId && (
        <textarea
          key={editingId}
          ref={textareaRef}
          className={`board-text-editor ${frame.align}`}
          defaultValue={frame.text}
          style={{
            left: frame.x,
            top: frame.y,
            width: frame.width,
            height: frame.height,
            fontSize: frame.fontSize,
          }}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (
              event.key === 'Escape' ||
              (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
            ) {
              event.preventDefault();
              commitText();
            }
          }}
        />
      )}

      <div className="board-toolbar">
        {TOOLS.map(({ name, label, key }) => (
          <button
            key={name}
            type="button"
            className={tool === name ? 'active' : ''}
            title={`${label} (${key})`}
            onClick={() => editorRef.current?.setTool(name)}
          >
            {label}
          </button>
        ))}
        <span className="board-separator" />
        <div className="board-colors">
          {COLORS.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`Couleur ${value}`}
              className={value === color ? 'selected' : ''}
              style={{ background: value }}
              onClick={() => setColor(value)}
            />
          ))}
        </div>
        <span className="board-separator" />
        <button
          type="button"
          disabled={selectionSize === 0}
          onClick={() => editorRef.current?.deleteSelection()}
        >
          Supprimer
        </button>
        <button type="button" onClick={() => editorRef.current?.fitContent()}>
          Recadrer
        </button>
        <button type="button" onClick={loadSample}>
          Exemple
        </button>
        <select
          aria-label="Mode de saisie"
          value={mode}
          onChange={(event) => setMode(event.target.value as InputMode)}
        >
          <option value="auto">Auto</option>
          <option value="pencil-only">Pencil seul</option>
          <option value="touch-drawing">Doigt dessine</option>
        </select>
        <a href="#/">Accueil</a>
      </div>

      <p className="board-help">
        Double-tap / double-clic sur une forme pour éditer son texte · Suppr pour supprimer · Échap
        pour revenir à la sélection
      </p>
    </div>
  );
}
