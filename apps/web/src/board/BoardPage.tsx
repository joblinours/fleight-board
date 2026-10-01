import { BoardEditor, type InputMode, type ToolName } from '@fleight/canvas';
import { CollaborationClient, type ConnectionStatus } from '@fleight/collaboration';
import type { Participant } from '@fleight/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sampleDiagram } from './sample-diagram';
import { connectWebSocket, displayName } from './websocket-transport';

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connexion…',
  joined: 'Connecté',
  closed: 'Déconnecté',
};

const TOOLS: Array<{ name: ToolName; label: string; key: string }> = [
  { name: 'select', label: 'Sélection', key: 'V' },
  { name: 'rectangle', label: 'Rectangle', key: 'R' },
  { name: 'ellipse', label: 'Ellipse', key: 'O' },
  { name: 'text', label: 'Texte', key: 'T' },
  { name: 'connector', label: 'Connecteur', key: 'C' },
  { name: 'pen', label: 'Stylo', key: 'P' },
];
const COLORS = ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#f59e0b'];

/** Whiteboard local (`boardId` absent) ou collaboratif. */
export function BoardPage({ boardId }: { boardId?: string }) {
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
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [participants, setParticipants] = useState<readonly Participant[]>([]);
  const [rejection, setRejection] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const sceneCanvas = sceneCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!container || !sceneCanvas || !overlayCanvas) return;

    const client = boardId
      ? new CollaborationClient({
          boardId,
          name: displayName(),
          onStatus: setStatus,
          onParticipants: setParticipants,
          onRejected: setRejection,
        })
      : undefined;
    const disconnect = client ? connectWebSocket(client) : undefined;

    const editor = new BoardEditor({
      sceneCanvas,
      overlayCanvas,
      ...(client
        ? {
            document: client.document,
            sink: {
              apply: (operations, gesture) => client.applyLocal(operations, gesture),
              endGesture: (gestureId) => client.endGesture(gestureId),
            },
          }
        : {}),
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
      disconnect?.();
      editor.dispose();
      editorRef.current = null;
    };
  }, [boardId]);

  useEffect(() => {
    if (!rejection) return;
    const timer = window.setTimeout(() => setRejection(null), 4000);
    return () => window.clearTimeout(timer);
  }, [rejection]);

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
    editor.replaceContent(sampleDiagram());
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

      {boardId && (
        <div className="board-session">
          <span className={`board-status ${status ?? 'connecting'}`}>
            {STATUS_LABELS[status ?? 'connecting']}
          </span>
          <span className="board-room">Board « {boardId} »</span>
          <ul>
            {participants.map(({ connectionId, name }) => (
              <li key={connectionId}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      {rejection && (
        <div className="board-toast" role="status">
          Une modification a été refusée par le serveur ; le board a été resynchronisé.
        </div>
      )}

      <p className="board-help">
        Double-tap / double-clic sur une forme pour éditer son texte · Suppr pour supprimer · Échap
        pour revenir à la sélection
      </p>
    </div>
  );
}
